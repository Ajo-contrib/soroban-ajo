import express from 'express';
import { i18nService } from '../services/i18nService';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../config/database';

export const languageRouter = express.Router();

// Get all supported languages
languageRouter.get('/api/languages', async (req, res) => {
  try {
    const languages = i18nService.getSupportedLanguages();
    res.json({
      success: true,
      data: languages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch languages',
    });
  }
});

// Get current user's language preference
languageRouter.get('/api/user/language-preference', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { languagePreference: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    res.json({
      success: true,
      data: {
        languagePreference: user.languagePreference || 'en',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch language preference',
    });
  }
});

// Set user's language preference
languageRouter.post('/api/user/language-preference', authMiddleware, async (req, res) => {
  try {
    const { language } = req.body;
    const userId = (req as any).userId;

    const supported = i18nService.getSupportedLanguages();
    const isSupported = supported.some(lang => lang.code === language);

    if (!isSupported) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported language',
      });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { languagePreference: language },
      select: { languagePreference: true },
    });

    res.json({
      success: true,
      data: {
        languagePreference: user.languagePreference,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update language preference',
    });
  }
});
