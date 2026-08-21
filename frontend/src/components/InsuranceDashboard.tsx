import React, { useEffect, useState } from 'react';
import { InsuranceService, InsurancePool, InsuranceClaim } from '../services/insuranceService';
import { RiskAssessmentService, RiskProfile } from '../services/riskAssessment';

export const InsuranceDashboard: React.FC = () => {
  const [pool, setPool] = useState<InsurancePool | null>(null);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [globalRisk, setGlobalRisk] = useState<RiskProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const insuranceService = new InsuranceService();
  const riskService = new RiskAssessmentService();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Mock token address for demo
        const tokenAddress = 'CAS3J7GYCCXG7YKS6273IKXJIBFGSK244U64S3E4L2UHSQUW6NWHI26B'; 

        const poolData = await insuranceService.getInsurancePool(tokenAddress);
        setPool(poolData);

        // Fetch claims (mocking data for UI demonstration)
        const mockClaims: InsuranceClaim[] = [
          {
            id: '1',
            groupId: '101',
            claimant: 'GBC...',
            amount: 100000000,
            status: 'approved',
            createdAt: new Date(Date.now() - 86400000),
            description: 'Missing contribution payout'
          },
          {
            id: '2',
            groupId: '105',
            claimant: 'GBC...',
            amount: 50000000,
            status: 'pending',
            createdAt: new Date(Date.now() - 3600000),
            description: 'Defaulted cycle claim'
          }
        ];
        setClaims(mockClaims);

        const riskData = await riskService.getGroupRiskProfile('1');
        setGlobalRisk(riskData);
      } catch (error) {
        console.error('Failed to fetch insurance data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const riskFactors = globalRisk?.factors
    ? [
        { label: 'Contribution History', value: globalRisk.factors.contributionHistory },
        { label: 'Group Participation', value: globalRisk.factors.groupParticipation },
        { label: 'Payment Reliability', value: globalRisk.factors.paymentReliability },
      ]
    : [];

  return (
    <div className="p-8 space-y-8 bg-slate-50 min-h-screen">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Insurance Dashboard</h1>
          <p className="text-slate-500 mt-1">Protecting the Ajo community through collective fallback.</p>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
            Download Report
          </button>
          <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-shadow shadow-sm">
            Configure Rates
          </button>
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
          <div className="text-sm font-medium text-slate-500 uppercase tracking-wider">Fund Balance</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">
            {(pool?.availableFunds || 0).toFixed(2)} XLM
          </div>
          <div className="mt-2 flex items-center text-xs font-medium text-emerald-600">
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            +12.5% from last cycle
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
          <div className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Coverage</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">
            {(pool?.totalCoverage || 0).toFixed(2)} XLM
          </div>
          <div className="mt-2 text-xs text-slate-400">Claims settled automatically</div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
          <div className="text-sm font-medium text-slate-500 uppercase tracking-wider">Active Claims</div>
          <div className="mt-2 text-3xl font-bold text-indigo-600">
            {pool?.activeClaims ?? 0}
          </div>
          <div className="mt-2 text-xs text-slate-400">Verifying automatically...</div>
        </div>

        <div className="bg-indigo-600 p-6 rounded-2xl shadow-md text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-indigo-500 rounded-full opacity-20"></div>
          <div className="text-sm font-medium opacity-80 uppercase tracking-wider relative z-10">Risk Rating</div>
          <div className="mt-2 text-3xl font-bold relative z-10">{globalRisk?.riskLevel || 'low'}</div>
          <div className="mt-2 text-xs opacity-70 relative z-10">System is stable</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Claims Table */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-lg font-bold text-slate-900">Recent Insurance Claims</h2>
            <a href="#" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">View All</a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">Group</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">Group #{claim.groupId}</div>
                      <div className="text-xs text-slate-500">{claim.description}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                        claim.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 
                        claim.status === 'pending' ? 'bg-amber-100 text-amber-700' : 
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {claim.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-semibold text-slate-900">
                      {(claim.amount / 10000000).toFixed(2)} XLM
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {new Date(claim.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-slate-400 hover:text-slate-600 p-1" aria-label={`View claim ${claim.id}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Risk Assessment Column */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Risk Factors</h2>
            <div className="space-y-4">
              {riskFactors.map((factor) => (
                <div key={factor.label} className="flex items-start gap-3">
                  <div className={`mt-1 w-2 h-2 rounded-full ${factor.value > 70 ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-700">{factor.label}</div>
                    <div className="text-xs text-slate-500">{factor.value}/100</div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 pt-6 border-t border-slate-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-slate-900">System Reliability</span>
                <span className="text-sm font-bold text-indigo-600">{globalRisk?.riskScore || 100}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div 
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-1000" 
                  style={{ width: `${globalRisk?.riskScore || 100}%` }}
                ></div>
              </div>
            </div>
          </div>

          <div className="bg-indigo-900 p-6 rounded-2xl shadow-md text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-indigo-800 p-2 rounded-lg">
                <svg className="w-5 h-5 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-bold">Pro-Tip</h3>
            </div>
            <p className="text-sm text-indigo-200 leading-relaxed">
              Groups with an insurance rate above 2% show a 95% higher member retention rate even during period defaults.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};