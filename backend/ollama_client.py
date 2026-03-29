"""Ollama LLM client for AI-generated answer suggestions."""

import os
import time
import httpx

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")

# Cached Ollama availability — avoids blocking match requests when Ollama is down
_ollama_available_cache: dict[str, tuple[bool, float]] = {}  # url -> (available, timestamp)
OLLAMA_CACHE_TTL = 30  # seconds

SYSTEM_PROMPT = """Bạn là nhân viên tư vấn bán hàng online tại Việt Nam.

NGUYÊN TẮC:
- Xưng "em", gọi khách là "anh/chị".
- Trả lời bằng tiếng Việt CÓ DẤU đầy đủ, ngắn gọn (1-3 câu), thân thiện, tự nhiên.
- Kết thúc câu bằng "ạ", "nha anh/chị", hoặc "nhé".
- KHÔNG BAO GIỜ trả lời bằng tiếng Trung, tiếng Anh hay ngôn ngữ khác.
- KHÔNG bịa thông tin sản phẩm. Chỉ trả lời dựa trên thông tin shop được cung cấp.
- Nếu không biết chính xác: "Em sẽ kiểm tra và báo lại anh/chị ngay ạ".

CÁCH TRẢ LỜI THÔNG MINH:
- Đọc kỹ lịch sử hội thoại để hiểu ngữ cảnh câu hỏi.
- Nếu khách hỏi tiếp về sản phẩm đã nhắc trước đó → trả lời dựa trên sản phẩm đó.
- Nếu khách hỏi giá/size/màu → trả lời cụ thể nếu có trong thông tin shop.
- Nếu khách chào hỏi → chào lại thân thiện, hỏi cần tư vấn gì.
- Nếu khách cảm ơn → đáp lễ, hỏi có cần gì thêm không.
- Nếu khách muốn đặt hàng → hướng dẫn cách đặt, hỏi thông tin giao hàng."""


async def check_ollama_available(ollama_url: str | None = None, use_cache: bool = True) -> bool:
    """Check if Ollama is running and reachable (cached for performance)."""
    url = ollama_url or OLLAMA_URL
    now = time.time()

    # Return cached result if fresh
    if use_cache and url in _ollama_available_cache:
        available, ts = _ollama_available_cache[url]
        if now - ts < OLLAMA_CACHE_TTL:
            return available

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{url}/api/tags")
            ok = resp.status_code == 200
            _ollama_available_cache[url] = (ok, now)
            return ok
    except Exception:
        _ollama_available_cache[url] = (False, now)
        return False


async def get_available_models(ollama_url: str | None = None) -> list[str]:
    """Get list of models currently available in Ollama."""
    url = ollama_url or OLLAMA_URL
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{url}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                return [m["name"] for m in data.get("models", [])]
    except Exception:
        pass
    return []


async def _call_ollama_generate(
    url: str, model: str, prompt: str, system: str,
    temperature: float = 0.7, num_predict: int = 256,
) -> dict | None:
    """Single Ollama generate call. Returns response dict or None on failure."""
    try:
        start_time = time.time()
        timeout = httpx.Timeout(connect=3.0, read=25.0, write=5.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "system": system,
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": num_predict,
                    },
                },
            )
            if resp.status_code != 200:
                return None

            data = resp.json()
            elapsed_ms = int((time.time() - start_time) * 1000)

            return {
                "answer": data.get("response", "").strip(),
                "model": model,
                "generation_time_ms": elapsed_ms,
            }
    except (httpx.ConnectError, httpx.TimeoutException, httpx.ReadTimeout):
        _ollama_available_cache[url] = (False, time.time())
        return None
    except Exception:
        return None


async def suggest_answer(
    question: str,
    context: list[dict] | None = None,
    conversation_history: list[dict] | None = None,
    tone: str = "friendly",
    shop_info: str | None = None,
    model: str | None = None,
    ollama_url: str | None = None,
    fallback_models: list[str] | None = None,
) -> dict | None:
    """Call Ollama API to generate an answer suggestion.

    Tries the primary model first, then each fallback model in order.
    Returns dict with 'answer', 'model', 'generation_time_ms' or None on failure.
    """
    url = ollama_url or OLLAMA_URL
    use_model = model or OLLAMA_MODEL

    # Build system prompt with shop info
    system = SYSTEM_PROMPT
    if tone == "professional":
        system = system.replace("thân thiện, tự nhiên", "chuyên nghiệp, lịch sự")
    elif tone == "casual":
        system = system.replace("thân thiện, tự nhiên", "thoải mái, dễ thương")
    if shop_info:
        system += f"\n\n=== THÔNG TIN SHOP (BẮT BUỘC ĐỌC) ===\n{shop_info}\n=== HẾT THÔNG TIN SHOP ==="

    # Build prompt with context
    prompt_parts = []

    # Include conversation history for context-aware responses
    if conversation_history:
        prompt_parts.append("=== LỊCH SỬ HỘI THOẠI ===")
        for msg in conversation_history:
            role = "Khách" if msg.get("role") == "customer" else "Shop"
            prompt_parts.append(f"{role}: {msg.get('content', '')}")
        prompt_parts.append("")

    if context:
        prompt_parts.append("=== CÂU TRẢ LỜI MẪU TỪ DATABASE (tham khảo phong cách) ===")
        for item in context:
            q = item.get("question", "")
            a = item.get("answer", "")
            if q and a:
                prompt_parts.append(f"Q: {q}\nA: {a}")
        prompt_parts.append("")

    prompt_parts.append(f"=== CÂU HỎI HIỆN TẠI ===\nKhách: {question}")
    prompt_parts.append("\nTrả lời ngắn gọn, đúng ngữ cảnh, dựa trên thông tin shop. Tiếng Việt có dấu.")

    full_prompt = "\n".join(prompt_parts)

    # Fast fail: check cached Ollama availability before making expensive LLM call
    if not await check_ollama_available(url):
        return None

    # Build model list: primary + fallbacks
    models_to_try = [use_model]
    if fallback_models:
        for m in fallback_models:
            if m and m != use_model:
                models_to_try.append(m)

    # Try each model in order until one succeeds
    for try_model in models_to_try:
        result = await _call_ollama_generate(url, try_model, full_prompt, system)
        if result and result["answer"]:
            return result

    return None


async def improve_answer(question: str, original_answer: str) -> str | None:
    """Use LLM to improve an existing answer. Returns improved text or None."""
    prompt = f"""Câu hỏi của khách: {question}
Câu trả lời gốc của shop: {original_answer}

Nếu câu trả lời gốc đã tốt rồi, trả về chính xác câu gốc.
Nếu có thể cải thiện (thêm thông tin, chỉnh giọng văn chuyên nghiệp hơn), hãy viết lại.
QUAN TRỌNG: Luôn viết tiếng Việt CÓ DẤU đầy đủ.
Chỉ trả lời bằng câu trả lời cải thiện, không giải thích thêm."""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "system": SYSTEM_PROMPT,
                    "stream": False,
                    "options": {"temperature": 0.5, "num_predict": 256},
                },
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            improved = data.get("response", "").strip()
            # If LLM returned essentially the same answer, return None
            if improved and improved != original_answer:
                return improved
            return None
    except Exception:
        return None
