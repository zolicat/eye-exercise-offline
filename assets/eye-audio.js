/* Pre-generated voice clips and an optional browser-local music library. */
window.createEyeAudio = function ({ voiceLevel, musicLevel, musicEnabled, isPlaying, voiceStatus, musicStatus }) {
  const packs = window.EYE_VOICE_PACKS;
  let clips = Object.values(packs)[0].clips;
  const recordings = new Map(Object.values(packs).flatMap(pack => Object.values(pack.clips)).map(clip => {
    const audio = new Audio(clip.src); audio.preload = 'auto'; return [clip.src, audio];
  }));
  const music = createMusicLibrary({
    level: musicLevel, enabled: musicEnabled, isPlaying, status: musicStatus,
    saveStatus: document.getElementById('musicSaveStatus'),
    removeButton: document.getElementById('removeMusic')
  });
  let active = null;
  function stopVoice() {
    const previous = active; active = null;
    if (previous) { previous.audio.pause(); previous.finish(); }
  }
  function playVoice(text) {
    stopVoice();
    if (voiceLevel() === 0) return Promise.resolve();
    const clip = clips[text];
    if (!clip) return Promise.reject(new Error('Missing voice clip'));
    const audio = recordings.get(clip.src);
    if (audio.error) audio.load();
    audio.currentTime = 0; audio.volume = voiceLevel();
    voiceStatus.textContent = '';
    return new Promise((resolve, reject) => {
      let timer, settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        audio.onended = audio.onerror = null;
        if (active?.audio === audio) active = null;
        audio.pause();
        if (error) { voiceStatus.textContent = '人声加载失败，请重试。'; reject(error); }
        else resolve();
      };
      active = { audio, finish };
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error('Voice decode failed'));
      timer = setTimeout(() => finish(new Error('Voice timeout')), Math.max(15000, (clip.duration + 5) * 1000));
      audio.play().catch(finish);
    });
  }
  return {
    setVoice(id) { if (!packs[id]) return; stopVoice(); clips = packs[id].clips; voiceStatus.textContent = ''; },
    playVoice, stopVoice,
    updateVoiceVolume() { if (active) active.audio.volume = voiceLevel(); if (voiceLevel() === 0) stopVoice(); },
    updateMusicVolume: music.updateVolume, syncMusic: music.sync,
    startMusic: music.start, pauseMusic: music.pause, resetMusic: music.reset,
    selectMusicFile: music.select, removeMusic: music.remove
  };
};
