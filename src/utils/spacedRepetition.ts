/**
 * Spaced Repetition System (SRS) using a simplified SM-2 algorithm.
 */

export interface SRSData {
  interval: number; // days
  repetition: number;
  easeFactor: number;
  nextReviewDate: Date;
}

export function calculateNextReview(
  quality: number, // 0-5 (0: wrong, 5: perfect)
  previousData?: SRSData
): SRSData {
  let { interval, repetition, easeFactor } = previousData || {
    interval: 0,
    repetition: 0,
    easeFactor: 2.5,
  };

  if (quality >= 3) {
    // Correct response
    if (repetition === 0) {
      interval = 1;
    } else if (repetition === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetition++;
  } else {
    // Incorrect response
    repetition = 0;
    interval = 1;
  }

  // Update ease factor: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);
  nextReviewDate.setHours(0, 0, 0, 0);

  return {
    interval,
    repetition,
    easeFactor,
    nextReviewDate,
  };
}
