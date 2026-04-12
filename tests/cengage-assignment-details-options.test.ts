import { describe, expect, it } from 'vitest';
import {
  escapeCssIdentifier,
  normalizeCaptureAssignmentRenderedMediaOptions,
  normalizeExtractAssignmentDetailsOptions,
} from '../src/scraper/cengage/assignment-details';

describe('cengage assignment details option normalization', () => {
  it('uses default extraction options when none are provided', () => {
    expect(normalizeExtractAssignmentDetailsOptions()).toEqual({
      maxQuestions: 50,
      maxQuestionTextChars: 2000,
      maxAnswerTextChars: 1200,
      includeAnswers: true,
      includeResources: true,
      includeAssetInventory: true,
      maxInteractiveAssets: 10,
      maxMediaAssets: 10,
    });
  });

  it('clamps and normalizes extraction options', () => {
    expect(
      normalizeExtractAssignmentDetailsOptions({
        maxQuestions: 0,
        maxQuestionTextChars: 99,
        maxAnswerTextChars: 2,
        includeAnswers: false,
        includeResources: false,
        includeAssetInventory: false,
        maxInteractiveAssets: 0,
        maxMediaAssets: 0,
      })
    ).toEqual({
      maxQuestions: 1,
      maxQuestionTextChars: 200,
      maxAnswerTextChars: 100,
      includeAnswers: false,
      includeResources: false,
      includeAssetInventory: false,
      maxInteractiveAssets: 1,
      maxMediaAssets: 1,
    });

    expect(
      normalizeExtractAssignmentDetailsOptions({
        maxQuestions: 9.8,
        maxQuestionTextChars: 2048.9,
        maxAnswerTextChars: 1500.2,
        maxInteractiveAssets: 4.9,
        maxMediaAssets: 6.1,
      })
    ).toEqual({
      maxQuestions: 9,
      maxQuestionTextChars: 2048,
      maxAnswerTextChars: 1500,
      includeAnswers: true,
      includeResources: true,
      includeAssetInventory: true,
      maxInteractiveAssets: 4,
      maxMediaAssets: 6,
    });
  });

  it('uses default rendered-media options when none are provided', () => {
    expect(normalizeCaptureAssignmentRenderedMediaOptions()).toEqual({
      maxRenderedImages: 20,
      maxCaptureUnits: 50,
      maxCapturePerQuestion: 1,
      maxPayloadBytes: 819200,
      minTextForSafeText: 250,
      captureDpi: 100,
    });
  });

  it('clamps and normalizes rendered-media options', () => {
    expect(
      normalizeCaptureAssignmentRenderedMediaOptions({
        maxRenderedImages: 999,
        maxCaptureUnits: 0,
        maxCapturePerQuestion: 0,
        maxPayloadBytes: 400,
        minTextForSafeText: 0,
        captureDpi: 10,
      })
    ).toEqual({
      maxRenderedImages: 20,
      maxCaptureUnits: 1,
      maxCapturePerQuestion: 1,
      maxPayloadBytes: 10000,
      minTextForSafeText: 1,
      captureDpi: 72,
    });

    expect(
      normalizeCaptureAssignmentRenderedMediaOptions({
        maxRenderedImages: 7.9,
        maxCaptureUnits: 12.6,
        maxCapturePerQuestion: 3.4,
        maxPayloadBytes: 123456.9,
        minTextForSafeText: 321.2,
        captureDpi: 144.9,
      })
    ).toEqual({
      maxRenderedImages: 7,
      maxCaptureUnits: 12,
      maxCapturePerQuestion: 3,
      maxPayloadBytes: 123456,
      minTextForSafeText: 321,
      captureDpi: 144,
    });
  });

  it('escapes CSS selector punctuation used in screenshot targeting', () => {
    expect(escapeCssIdentifier('question 1(#a).b')).toBe(
      'question\\ 1\\(\\#a\\)\\.b'
    );
  });
});
