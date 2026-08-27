export function createAudioContext() {
  const legacyWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext
  }
  const AudioContextConstructor = window.AudioContext ?? legacyWindow.webkitAudioContext
  if (!AudioContextConstructor)
    throw new Error('Web Audio API is not supported')
  return new AudioContextConstructor()
}
