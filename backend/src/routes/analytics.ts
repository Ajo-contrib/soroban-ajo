import { Router } from 'express';
import { AnalyticsService } from '../services/analyticsService';

const router = Router();
const analyticsService = new AnalyticsService();

router.get('/analytics/group/:groupId/performance', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { period = '30d' } = req.query;
    
    const analytics = await analyticsService.getGroupPerformance(groupId, period as string);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch group performance' });
  }
});

router.get('/analytics/member/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    
    const analytics = await analyticsService.getMemberAnalytics(memberId);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch member analytics' });
  }
});

router.get('/analytics/group/:groupId/patterns', async (req, res) => {
  try {
    const { groupId } = req.params;
    
    const patterns = await analyticsService.analyzeContributionPatterns(groupId);
    res.json(patterns);
  } catch (error) {
    res.status(500).json({ error: 'Failed to analyze patterns' });
  }
});

router.get('/analytics/group/:groupId/trends', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { period = '30d' } = req.query;
    
    const trends = await analyticsService.getFinancialTrends(groupId, period as string);
    res.json(trends);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch financial trends' });
  }
});

router.post('/analytics/report', async (req, res) => {
  try {
    const { type, format, filters } = req.body;
    
    const report = await analyticsService.generateReport(type, { format, filters });
    res.json({ report });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

router.post('/analytics/schedule', async (req, res) => {
  try {
    const config = req.body;
    
    const job = await analyticsService.scheduleReport(config);
    res.json({ job });
  } catch (error) {
    res.status(500).json({ error: 'Failed to schedule report' });
  }
});

export default router;
