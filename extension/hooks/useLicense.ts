import { useState, useEffect, useCallback } from 'react'

// ============================================================
// License Tier System
// ============================================================

export type Tier = 'free' | 'basic' | 'pro'

export interface LicenseInfo {
  tier: Tier
  key: string | null
  expiresAt: string | null // ISO date or null for free
  activated: boolean
  subscriptionStatus?: 'active' | 'cancelled' | 'paused' | 'expired' | null
  renewsAt?: string | null
  lastRenewalCheck?: string | null
}

export interface TierLimits {
  maxQA: number
  autoReply: boolean
  multiPlatform: boolean
  scanHistory: boolean
  customTone: boolean
  aiSuggest: boolean
  importFile: boolean
}

const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxQA: 30,
    autoReply: false,
    multiPlatform: false,
    scanHistory: false,
    customTone: false,
    aiSuggest: false,
    importFile: true,
  },
  basic: {
    maxQA: 500,
    autoReply: false,
    multiPlatform: false,
    scanHistory: true,
    customTone: false,
    aiSuggest: true,
    importFile: true,
  },
  pro: {
    maxQA: Infinity,
    autoReply: true,
    multiPlatform: true,
    scanHistory: true,
    customTone: true,
    aiSuggest: true,
    importFile: true,
  },
}

export function getTierLimits(tier: Tier): TierLimits {
  return TIER_LIMITS[tier]
}

const STORAGE_KEY = 'shopreply_license'
const WORKER_URL = 'https://shopreply-payment.nhamingroup.workers.dev'
const RENEWAL_CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

const DEFAULT_LICENSE: LicenseInfo = {
  tier: 'free',
  key: null,
  expiresAt: null,
  activated: false,
  subscriptionStatus: null,
  renewsAt: null,
  lastRenewalCheck: null,
}

// ---- Simple license key validation ----
// Format: SHOP-TTTT-XXXX-CCCC
// TTTT = tier code: BSC1 = basic, PRO1 = pro
// XXXX = random alphanumeric (4 chars)
// CCCC = checksum (first 4 chars of simple hash)

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return Math.abs(hash).toString(36).toUpperCase().padStart(4, '0').slice(0, 4)
}

export function validateLicenseKey(key: string): { valid: boolean; tier: Tier; error?: string } {
  const parts = key.toUpperCase().trim().split('-')
  if (parts.length !== 4 || parts[0] !== 'SHOP') {
    return { valid: false, tier: 'free', error: 'invalid_key_format' }
  }

  const [, tierCode, random, checksum] = parts

  // Validate checksum
  const expected = simpleHash(`SHOP-${tierCode}-${random}`)
  if (checksum !== expected) {
    return { valid: false, tier: 'free', error: 'invalid_key' }
  }

  // Determine tier
  let tier: Tier = 'free'
  if (tierCode.startsWith('BSC')) tier = 'basic'
  else if (tierCode.startsWith('PRO')) tier = 'pro'
  else return { valid: false, tier: 'free', error: 'invalid_tier' }

  return { valid: true, tier }
}

// ---- Generate a valid key (for testing/admin) ----
export function generateLicenseKey(tier: 'basic' | 'pro'): string {
  const tierCode = tier === 'basic' ? 'BSC1' : 'PRO1'
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let random = ''
  for (let i = 0; i < 4; i++) {
    random += chars[Math.floor(Math.random() * chars.length)]
  }
  const checksum = simpleHash(`SHOP-${tierCode}-${random}`)
  return `SHOP-${tierCode}-${random}-${checksum}`
}

// ---- React hook ----

export function useLicense() {
  const [license, setLicense] = useState<LicenseInfo>(DEFAULT_LICENSE)
  const [loading, setLoading] = useState(true)

  // Load from storage
  useEffect(() => {
    browser.storage.local.get(STORAGE_KEY).then((result) => {
      const stored = result[STORAGE_KEY] as LicenseInfo | undefined
      if (stored) {
        // Check expiry
        if (stored.expiresAt && new Date(stored.expiresAt) < new Date()) {
          setLicense({ ...DEFAULT_LICENSE })
        } else {
          setLicense(stored)
        }
      }
      setLoading(false)
    })
  }, [])

  // Auto-renewal check: sync expiresAt from server
  const checkRenewal = useCallback(async (licenseInfo: LicenseInfo) => {
    if (!licenseInfo.key || !licenseInfo.activated) return

    // Only check once per RENEWAL_CHECK_INTERVAL
    if (licenseInfo.lastRenewalCheck) {
      const lastCheck = new Date(licenseInfo.lastRenewalCheck).getTime()
      if (Date.now() - lastCheck < RENEWAL_CHECK_INTERVAL) return
    }

    try {
      const res = await fetch(`${WORKER_URL}/api/check-renewal?key=${encodeURIComponent(licenseInfo.key)}`)
      if (!res.ok) return

      const data = await res.json()
      if (!data.success) return

      const updated: LicenseInfo = { ...licenseInfo, lastRenewalCheck: new Date().toISOString() }

      // Server has expiresAt (LemonSqueezy subscription) → sync it
      if (data.expiresAt) {
        updated.expiresAt = data.expiresAt
      }
      if (data.subscriptionStatus) {
        updated.subscriptionStatus = data.subscriptionStatus
      }
      if (data.renewsAt) {
        updated.renewsAt = data.renewsAt
      }

      // Check if expired after sync
      if (updated.expiresAt && new Date(updated.expiresAt) < new Date()) {
        // Expired — revert to free
        await browser.storage.local.set({ [STORAGE_KEY]: DEFAULT_LICENSE })
        setLicense(DEFAULT_LICENSE)
        return
      }

      await browser.storage.local.set({ [STORAGE_KEY]: updated })
      setLicense(updated)
    } catch {
      // Network error — skip this check, try again later
    }
  }, [])

  // Run renewal check on load
  useEffect(() => {
    if (!loading && license.activated && license.key) {
      checkRenewal(license)
    }
  }, [loading, license.activated, license.key, checkRenewal])

  const activate = useCallback(async (key: string): Promise<{ success: boolean; error?: string }> => {
    const result = validateLicenseKey(key)
    if (!result.valid) {
      return { success: false, error: result.error }
    }

    // Set expiry to 1 year from now
    const expiresAt = new Date()
    expiresAt.setFullYear(expiresAt.getFullYear() + 1)

    const newLicense: LicenseInfo = {
      tier: result.tier,
      key: key.toUpperCase().trim(),
      expiresAt: expiresAt.toISOString(),
      activated: true,
    }

    await browser.storage.local.set({ [STORAGE_KEY]: newLicense })
    setLicense(newLicense)
    return { success: true }
  }, [])

  const deactivate = useCallback(async () => {
    await browser.storage.local.set({ [STORAGE_KEY]: DEFAULT_LICENSE })
    setLicense(DEFAULT_LICENSE)
  }, [])

  const limits = getTierLimits(license.tier)

  return {
    license,
    limits,
    loading,
    activate,
    deactivate,
  }
}
