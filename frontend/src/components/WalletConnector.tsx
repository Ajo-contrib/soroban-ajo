import { IS_TESTNET, fundWithFriendbot, getAddFundsUrl } from '../services/soroban'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatRelativeTime, formatXLMCompact, truncateAddress } from '../utils/formatters'

import { BalanceDisplay } from './BalanceDisplay'
import { detectWallets } from '../utils/walletDetection'
import { useAuthContext } from '../context/AuthContext'
import { useWalletBalance } from '../hooks/useWalletBalance'

type Tab = 'balance' | 'transactions'

/**
 * WalletConnector — replaces the existing WalletConnector.tsx
 *
 * Keeps all existing behaviour (connect, disconnect, logoutAllDevices, network badge)
 * and adds:
 *   - XLM balance shown in the header button
 *   - Dropdown balance breakdown (available / locked / reserve)
 *   - Recent transactions tab
 *   - Add Funds button (Friendbot on testnet, StellarX on mainnet)
 *   - Balance refreshes automatically every 30s and after transactions
 */
export const WalletConnector: React.FC = () => {
  const {
    isAuthenticated,
    isLoading,
    address,
    network,
    pendingTwoFactor,
    login,
    verifyTwoFactor,
    cancelTwoFactor,
    logout,
    logoutAllDevices,
  } = useAuthContext()

  const { balance, recentTxs, refetch } = useWalletBalance(address)

  const [showMenu, setShowMenu] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('balance')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [isFunding, setIsFunding] = useState(false)
  const [fundSuccess, setFundSuccess] = useState(false)
  const [showWalletSelection, setShowWalletSelection] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState('')

  const menuRef = useRef<HTMLDivElement>(null)

  // Detect wallets using comprehensive detection
  const walletDetection = detectWallets()

  // Suggestion: Centralize wallet configuration, potentially in a separate file or context
  // This makes it easier to add/remove/modify wallets without changing the component logic.
  const getAvailableWallets = useCallback(() => {
    return [
      {
        name: 'Freighter',
        provider: 'freighter' as const,
        isInstalled: walletDetection.freighter,
        icon: '🚀',
        description: 'Browser extension',
      },
      {
        name: 'LOBSTR',
        provider: 'lobstr' as const,
        isInstalled: walletDetection.lobstr,
        icon: '🦞',
        description: 'Mobile app or Vault extension',
      },
      {
        name: 'Albedo',
        provider: 'albedo' as const,
        isInstalled: walletDetection.albedo,
        icon: '⭐',
        description: 'Web-based wallet',
      },
    ]
  }, [walletDetection])

  // Portal target (document.body) only exists client-side after mount
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  useEffect(() => {
    if (isAuthenticated) {
      setShowWalletSelection(false)
      setTwoFactorCode('')
      // If wallet selection is shown, and then authenticated, it should close.
      // This is already handled by setShowWalletSelection(false).
    }
  }, [isAuthenticated])

  const handleConnect = async (provider: 'freighter' | 'lobstr' | 'albedo') => {
    try {
      setConnectError(null)
      await login({ provider, rememberMe: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect wallet'
      setConnectError(msg)
      console.error('Wallet connection error:', err)
    }
  }

  const handleTwoFactorSubmit = async () => {
    try {
      setConnectError(null)
      await verifyTwoFactor(twoFactorCode)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to verify two-factor code'
      setConnectError(msg)
    }
  }

  const handleFriendbot = useCallback(async () => {
    if (!address || isFunding) return
    setIsFunding(true)
    setFundSuccess(false)
    const ok = await fundWithFriendbot(address)
    setIsFunding(false)
    if (ok) {
      setFundSuccess(true)
      // Refetch balance after Horizon indexes the fund (≈3 s)
      setTimeout(() => {
        refetch()
        setFundSuccess(false)
      }, 3500)
    }
  }, [address, isFunding, refetch])

  const truncated = address ? truncateAddress(address) : ''

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    )
  }

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowWalletSelection(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          Connect Wallet
        </button>

        {/* Wallet Selection Modal — portaled to <body> so it isn't trapped
            inside the desktop header's backdrop-blur containing block
            (backdrop-filter on an ancestor makes position:fixed
            descendants position relative to it instead of the viewport) */}
        {isMounted &&
          (showWalletSelection || pendingTwoFactor) &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4"
              onClick={(event) => {
                if (event.target !== event.currentTarget) return
                if (pendingTwoFactor) {
                  cancelTwoFactor()
                }
                setShowWalletSelection(false)
              }}
            >
              <div className="my-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    {pendingTwoFactor ? 'Enter authentication code' : 'Select Wallet'}
                  </h3>
                  <button
                    onClick={() => {
                      if (pendingTwoFactor) {
                        cancelTwoFactor()
                      }
                      setShowWalletSelection(false)
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {pendingTwoFactor ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Two-factor authentication is enabled for {pendingTwoFactor.address}. Enter the
                      6-digit code from your authenticator app to finish signing in.
                    </p>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={twoFactorCode}
                      onChange={(event) =>
                        setTwoFactorCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-2xl tracking-[0.4em] text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                      placeholder="123456"
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={handleTwoFactorSubmit}
                        disabled={twoFactorCode.length !== 6}
                        className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        Verify code
                      </button>
                      <button
                        onClick={() => {
                          cancelTwoFactor()
                          setShowWalletSelection(false)
                        }}
                        className="rounded-lg border border-gray-300 px-4 py-3 font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      {getAvailableWallets().map((wallet) => (
                        <button
                          key={wallet.provider}
                          onClick={() => handleConnect(wallet.provider)}
                          disabled={!wallet.isInstalled}
                          className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                            wallet.isInstalled
                              ? 'border-gray-200 hover:border-blue-500 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/20 cursor-pointer'
                              : 'border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900 cursor-not-allowed opacity-60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">{wallet.icon}</span>
                              <div>
                                <p className="font-semibold text-gray-900 dark:text-white">
                                  {wallet.name}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {wallet.description}
                                </p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                  {wallet.isInstalled ? '✓ Ready to connect' : '✗ Not installed'}
                                </p>
                              </div>
                            </div>
                            {wallet.isInstalled && (
                              <svg
                                className="w-5 h-5 text-green-500"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <p className="text-xs text-blue-800 dark:text-blue-200">
                        <strong>Don't have a wallet?</strong>
                        <br />
                        Install{' '}
                        <a
                          href="https://freighter.app"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Freighter
                        </a>
                        ,{' '}
                        <a
                          href="https://lobstr.co"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          LOBSTR
                        </a>
                        , or{' '}
                        <a
                          href="https://vault.lobstr.co"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Lobstr Vault
                        </a>
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body
          )}

        {connectError && (
          <div className="absolute top-full mt-2 right-0 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm max-w-xs z-50">
            {connectError}
          </div>
        )}
      </div>
    )
  }

  // ── Connected ─────────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger button — same styling as original, adds balance */}
      <button
        onClick={() => setShowMenu((prev) => !prev)}
        className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition"
        aria-expanded={showMenu}
      >
        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-800">{truncated}</span>
        <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{network}</span>

        {/* Balance badge — new */}
        <span className="hidden sm:flex items-center">
          {balance.isLoading ? (
            <span className="h-3.5 w-16 rounded bg-gray-200 animate-pulse" />
          ) : (
            <span className="text-sm font-semibold text-gray-800">
              {formatXLMCompact(balance.available)}
            </span>
          )}
        </span>

        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${showMenu ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />

          <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-100 z-50 overflow-hidden">
            {/* Address + actions */}
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Connected as</p>
                  <p className="text-sm font-mono text-gray-800 break-all mt-0.5">{address}</p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100">
              {(['balance', 'transactions'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                    activeTab === tab
                      ? 'text-blue-600 border-b-2 border-blue-600 -mb-px bg-blue-50/30'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* ── Balance tab ── */}
            {activeTab === 'balance' && (
              <div className="px-4 py-4 space-y-4">
                <BalanceDisplay balance={balance} showBreakdown />

                {/* Add Funds */}
                <div className="border border-gray-100 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Add Funds
                  </p>
                  {IS_TESTNET ? (
                    <button
                      onClick={handleFriendbot}
                      disabled={isFunding || fundSuccess}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition disabled:opacity-60"
                    >
                      {isFunding ? (
                        <>
                          <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          Requesting…
                        </>
                      ) : fundSuccess ? (
                        <>
                          <svg
                            className="w-4 h-4 text-green-300"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Funded! Refreshing…
                        </>
                      ) : (
                        <>
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 2C6 9 4 13 4 16a8 8 0 0016 0c0-3-2-7-8-14z"
                            />
                          </svg>
                          Get Testnet XLM (Friendbot)
                        </>
                      )}
                    </button>
                  ) : (
                    <a
                      href={getAddFundsUrl(address!)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                      Buy XLM on StellarX
                    </a>
                  )}
                  <p className="text-[10px] text-gray-400 text-center">
                    {IS_TESTNET
                      ? 'Testnet tokens have no real value'
                      : 'You will be redirected to an exchange'}
                  </p>
                </div>

                {/* Refresh */}
                <button
                  onClick={refetch}
                  disabled={balance.isLoading}
                  className="w-full py-1.5 text-xs text-gray-400 hover:text-gray-600 transition flex items-center justify-center gap-1"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${balance.isLoading ? 'animate-spin' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  {balance.isLoading ? 'Refreshing…' : 'Refresh balance'}
                </button>
              </div>
            )}

            {/* ── Transactions tab ── */}
            {activeTab === 'transactions' && (
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                {balance.isLoading ? (
                  <div className="p-4 space-y-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 bg-gray-100 rounded w-3/4" />
                          <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                        </div>
                        <div className="h-3 bg-gray-100 rounded w-14" />
                      </div>
                    ))}
                  </div>
                ) : recentTxs.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm text-gray-400">No recent transactions</p>
                  </div>
                ) : (
                  recentTxs.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                    >
                      {/* Icon circle */}
                      <div className="relative flex-shrink-0">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${txBg(tx.type)}`}
                        >
                          <svg
                            className={`w-4 h-4 ${txColor(tx.type)}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d={txIcon(tx.type)}
                            />
                          </svg>
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${statusDot(tx.status)}`}
                        />
                      </div>
                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${txColor(tx.type)}`}>
                          {txLabel(tx.type)}
                        </p>
                        {tx.groupName && (
                          <p className="text-xs text-gray-400 truncate">{tx.groupName}</p>
                        )}
                        <p className="text-[10px] text-gray-400">
                          {formatRelativeTime(tx.timestamp)}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-gray-800 tabular-nums">
                        {parseFloat(tx.amount).toFixed(2)} XLM
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── Footer actions (same as original) ── */}
            <div className="border-t border-gray-100 py-1">
              <button
                onClick={async () => {
                  setShowMenu(false)
                  await logout()
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                Disconnect
              </button>
              <button
                onClick={async () => {
                  setShowMenu(false)
                  await logoutAllDevices()
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
                Sign out all devices
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tx display helpers ────────────────────────────────────────────────────────

type TxType = 'contribution' | 'withdrawal' | 'payout' | 'fee' | 'other'

function txLabel(type: TxType): string {
  return {
    contribution: 'Contribution',
    withdrawal: 'Withdrawal',
    payout: 'Payout received',
    fee: 'Fee',
    other: 'Transaction',
  }[type]
}
function txColor(type: TxType): string {
  return {
    contribution: 'text-blue-600',
    withdrawal: 'text-purple-600',
    payout: 'text-green-600',
    fee: 'text-gray-400',
    other: 'text-gray-500',
  }[type]
}
function txBg(type: TxType): string {
  return {
    contribution: 'bg-blue-50',
    withdrawal: 'bg-purple-50',
    payout: 'bg-green-50',
    fee: 'bg-gray-50',
    other: 'bg-gray-50',
  }[type]
}
function txIcon(type: TxType): string {
  if (type === 'payout')
    return 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'
  if (type === 'withdrawal') return 'M3 12h18M12 4l8 8-8 8'
  return 'M12 4v16m8-8H4'
}
function statusDot(status: 'success' | 'pending' | 'failed'): string {
  return { success: 'bg-green-500', pending: 'bg-amber-400 animate-pulse', failed: 'bg-red-500' }[
    status
  ]
}
