export type SpeechOptions = {
  enabled: boolean;
  voice: string;
  rate: number;
  volume: number;
};

export type SpeechResult = 'ended' | 'cancelled';

export class SpeechController {
  private finishActive: ((result: SpeechResult) => void) | null = null;

  stop() {
    const finish = this.finishActive;
    this.finishActive = null;
    finish?.('cancelled');
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  speak(text: string, options: SpeechOptions) {
    return new Promise<SpeechResult>((resolve) => {
      if (!options.enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve('ended');
        return;
      }

      this.stop();
      let settled = false;
      const finish = (result: SpeechResult) => {
        if (settled) return;
        settled = true;
        if (this.finishActive === finish) this.finishActive = null;
        resolve(result);
      };
      this.finishActive = finish;

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = window.speechSynthesis.getVoices().find((item) => item.name === options.voice);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'ja-JP';
      utterance.rate = options.rate;
      utterance.volume = options.volume;
      utterance.onend = () => finish('ended');
      utterance.onerror = () => finish('cancelled');
      window.speechSynthesis.speak(utterance);
    });
  }

  announce(text: string, options: SpeechOptions) {
    if (!options.enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = window.speechSynthesis.getVoices().find((item) => item.name === options.voice);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'ja-JP';
    utterance.rate = options.rate;
    utterance.volume = options.volume;
    window.speechSynthesis.speak(utterance);
  }
}
