'use client';

import React, { useState } from 'react';
import { useMultiSig, MultiSigProposal } from '@/hooks/useMultiSig';

interface MultiSigApprovalProps {
  groupId: string;
  apiUrl: string;
  currentUser: string;
  /** Called when a proposal reaches its threshold */
  onApproved?: (proposal: MultiSigProposal) => void;
}

export default function MultiSigApproval({
  groupId,
  apiUrl,
  currentUser,
  onApproved,
}: MultiSigApprovalProps) {
  const { proposals, loading, error, createProposal, signProposal } = useMultiSig(apiUrl);
  const [newSigners, setNewSigners] = useState('');
  const [threshold, setThreshold] = useState(2);

  const groupProposals = Array.from(proposals.values()).filter(
    (p) => (p as MultiSigProposal & { groupId?: string }).groupId === groupId
  );

  async function handleCreate() {
    const signers = newSigners.split(',').map((s) => s.trim()).filter(Boolean);
    if (signers.length === 0) return;
    await createProposal(signers, threshold);
    setNewSigners('');
  }

  async function handleSign(proposalId: string) {
    const updated = await signProposal(proposalId, currentUser);
    if (updated.status === 'complete') onApproved?.(updated);
  }

  const signedCount = (p: MultiSigProposal) =>
    p.signers.filter((s) => s.signed).length;

  return (
    <div className="space-y-6">
      {/* Create proposal */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          New Multi-Sig Proposal
        </h3>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Signer addresses (comma-separated)"
            value={newSigners}
            onChange={(e) => setNewSigners(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400">Threshold:</label>
            <input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
            <button
              onClick={handleCreate}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      </div>

      {/* Proposal list */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {groupProposals.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No pending proposals.</p>
      ) : (
        <ul className="space-y-3">
          {groupProposals.map((p) => {
            const signed = signedCount(p);
            const userSigned = p.signers.some(
              (s) => s.address === currentUser && s.signed
            );
            const isExpired = Date.now() > p.expiresAt;

            return (
              <li
                key={p.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Proposal {p.id.slice(0, 8)}…
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {signed}/{p.threshold} signatures · {p.status}
                    </p>
                  </div>

                  {/* Progress bar */}
                  <div className="w-32">
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min((signed / p.threshold) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {!userSigned && !isExpired && p.status !== 'complete' && (
                  <button
                    onClick={() => handleSign(p.id)}
                    disabled={loading}
                    className="mt-3 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Sign
                  </button>
                )}

                {p.status === 'complete' && (
                  <span className="mt-2 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                    ✓ Approved
                  </span>
                )}

                {isExpired && p.status !== 'complete' && (
                  <span className="mt-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                    Expired
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
