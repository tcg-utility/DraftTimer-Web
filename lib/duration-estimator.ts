import { buildSteps, compileTimer, stepFixedDelaySeconds, stepSpeechCues, type TimerSettings } from '@/lib/timer-domain';

function japaneseNumberMoraCount(value: number) {
  const digitMora = [2, 2, 2, 2, 2, 2, 2, 3, 2, 2];
  let number = Math.max(0, Math.floor(value));
  if (number === 0) return digitMora[0];
  let mora = 0;
  const thousands = Math.floor(number / 1000) % 10;
  if (thousands) mora += thousands === 1 ? 2 : thousands === 3 || thousands === 8 ? 4 : digitMora[thousands] + 2;
  const hundreds = Math.floor(number / 100) % 10;
  if (hundreds) mora += hundreds === 1 ? 3 : hundreds === 3 || hundreds === 6 || hundreds === 8 ? 4 : digitMora[hundreds] + 3;
  const tens = Math.floor(number / 10) % 10;
  if (tens) mora += tens === 1 ? 2 : digitMora[tens] + 2;
  number %= 10;
  if (number) mora += digitMora[number];
  return mora;
}

export function estimateSpeechSeconds(text: string) {
  let mora = 0;
  let punctuationSeconds = 0;
  const tokens = text.match(/[0-9]+|./gu) ?? [];
  for (const token of tokens) {
    if (/^[0-9]+$/.test(token)) mora += japaneseNumberMoraCount(Number(token));
    else if (/\p{Script=Han}/u.test(token)) mora += 1.8;
    else if (/[ぁ-んァ-ヶー]/u.test(token)) mora += 1;
    else if (/[、,！!]/u.test(token)) punctuationSeconds += 0.18;
    else if (/[。？?]/u.test(token)) punctuationSeconds += 0.32;
    else if (!/\s/u.test(token)) mora += 1;
  }
  return 0.2 + mora / 6.2 + punctuationSeconds;
}

export function estimateMinutes(settings: TimerSettings) {
  const runtime = compileTimer(settings);
  const totalSeconds = buildSteps(runtime).reduce((sum, step) => {
    const speechSeconds = stepSpeechCues(step, runtime).reduce((speech, text) => speech + estimateSpeechSeconds(text), 0);
    return sum + step.seconds + stepFixedDelaySeconds(step) + speechSeconds;
  }, 0);
  return (totalSeconds / 60).toFixed(1);
}
