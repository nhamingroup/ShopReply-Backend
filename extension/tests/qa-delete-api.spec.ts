import { test, expect } from '@playwright/test';

const API = 'http://localhost:3939/api';

test.describe('Q&A Delete — Backend API Integration', () => {
  let createdId: number;

  test('create → delete → verify not in active list', async ({ request }) => {
    // Step 1: Create a test Q&A
    const createRes = await request.post(`${API}/qa`, {
      data: { question: 'PW_TEST_DELETE', answer: 'test answer for delete' },
    });
    expect(createRes.ok()).toBeTruthy();
    const createJson = await createRes.json();
    createdId = createJson.data.id;
    expect(createdId).toBeGreaterThan(0);

    // Step 2: Verify it exists in the active list
    const listBefore = await request.get(`${API}/qa?search=PW_TEST_DELETE&is_active=true`);
    const listBeforeJson = await listBefore.json();
    expect(listBeforeJson.data.total).toBe(1);

    // Step 3: Delete it
    const deleteRes = await request.delete(`${API}/qa/${createdId}`);
    expect(deleteRes.ok()).toBeTruthy();
    const deleteJson = await deleteRes.json();
    expect(deleteJson.data.deleted).toBe(true);

    // Step 4: Verify it's gone from active list
    const listAfter = await request.get(`${API}/qa?search=PW_TEST_DELETE&is_active=true`);
    const listAfterJson = await listAfter.json();
    expect(listAfterJson.data.total).toBe(0);

    // Step 5: Verify it still exists as inactive (soft delete)
    const listInactive = await request.get(`${API}/qa?search=PW_TEST_DELETE&is_active=false`);
    const listInactiveJson = await listInactive.json();
    expect(listInactiveJson.data.total).toBeGreaterThanOrEqual(1);
    const deletedItem = listInactiveJson.data.items.find((i: any) => i.id === createdId);
    expect(deletedItem).toBeTruthy();
    expect(deletedItem.is_active).toBe(false);
  });
});
