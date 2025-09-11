const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const remoteAudio = document.getElementById('remoteAudio');
const logEl = document.getElementById('log');
const transcriptEl = document.getElementById('transcript');
const debugChk = document.getElementById('debugChk');
const clearLogBtn = document.getElementById('clearLogBtn');

let pc, localStream, dataChannel;
let transcriptBuffer = { user: '', assistant: '' };
let transcriptTimeouts = { user: null, assistant: null };

function log(line, cls='') {
  const p = document.createElement('div');
  p.innerText = line;
  if (cls) p.className = cls;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
}

function dlog(...args) {
  if (!debugChk || !debugChk.checked) return;
  const text = args.map(a => {
    try { return typeof a === 'string' ? a : JSON.stringify(a); }
    catch { return String(a); }
  }).join(' ');
  log(text, 'badge');
}

function clearTranscript() {
  if (transcriptEl) transcriptEl.innerHTML = '';
  // Reset buffers and clear any pending timeouts
  transcriptBuffer = { user: '', assistant: '' };
  if (transcriptTimeouts.user) {
    clearTimeout(transcriptTimeouts.user);
    transcriptTimeouts.user = null;
  }
  if (transcriptTimeouts.assistant) {
    clearTimeout(transcriptTimeouts.assistant);
    transcriptTimeouts.assistant = null;
  }
}

function makeLine(role, text = '', live = false) {
  const el = document.createElement('div');
  el.className = role;
  if (live) el.dataset.live = '1';
  el.textContent = text;
  return el;
}

function getOrCreateLiveLine(role) {
  if (!transcriptEl) return null;
  let live = transcriptEl.querySelector(`.${role}[data-live="1"]`);
  if (!live) {
    live = makeLine(role, '', true);
    transcriptEl.appendChild(live);
  }
  return live;
}

function finalizeLiveLine(role, finalTextIfAny) {
  if (!transcriptEl) return;
  const live = transcriptEl.querySelector(`.${role}[data-live="1"]`);
  if (live) {
    if (typeof finalTextIfAny === 'string' && finalTextIfAny.length) {
      live.textContent = finalTextIfAny;
    }
    delete live.dataset.live;
  }
  // Clear buffer and timeout for this role
  transcriptBuffer[role] = '';
  if (transcriptTimeouts[role]) {
    clearTimeout(transcriptTimeouts[role]);
    transcriptTimeouts[role] = null;
  }
}

function updateTranscriptWithDebounce(role, text, isFinal = false) {
  if (isFinal) {
    // For final text, cancel any pending updates and apply immediately
    if (transcriptTimeouts[role]) {
      clearTimeout(transcriptTimeouts[role]);
      transcriptTimeouts[role] = null;
    }
    transcriptBuffer[role] = '';
    finalizeLiveLine(role, text);
  } else {
    // Accumulate text in buffer
    transcriptBuffer[role] += text;
    
    // Clear existing timeout
    if (transcriptTimeouts[role]) {
      clearTimeout(transcriptTimeouts[role]);
    }
    
    // Set new timeout to update UI after 1 second of no new updates
    transcriptTimeouts[role] = setTimeout(() => {
      const live = getOrCreateLiveLine(role);
      if (live && transcriptBuffer[role]) {
        live.textContent = transcriptBuffer[role];
      }
      transcriptTimeouts[role] = null;
    }, 1000);
    
    // Also update immediately for better UX
    const live = getOrCreateLiveLine(role);
    if (live) {
      live.textContent = transcriptBuffer[role];
    }
  }
}

function extractTextFromResponseCompleted(msg) {
  if (!msg) return undefined;
  if (typeof msg.text === 'string') return msg.text;
  if (msg.response) {
    if (typeof msg.response.output_text === 'string') return msg.response.output_text;
    if (typeof msg.response.text === 'string') return msg.response.text;
    // Check for output array with content items
    if (Array.isArray(msg.response.output)) {
      for (const item of msg.response.output) {
        if (item.content && Array.isArray(item.content)) {
          const transcripts = item.content
            .filter(c => c && (c.type === 'audio' || c.type === 'text'))
            .map(c => c.transcript || c.text)
            .filter(Boolean);
          if (transcripts.length) return transcripts.join(' ');
        }
      }
    }
  }
  return undefined;
}

async function start() {
  startBtn.disabled = true;
  statusEl.textContent = 'starting…';

  clearTranscript();
  dlog('[client] start called');

  // Get ephemeral token from our server
  dlog('[client] fetching /session');
  const tokenResp = await fetch('/session').catch(err => {
    log('Request /session failed: ' + err.message);
    throw err;
  });
  dlog('[client] /session status', tokenResp?.status);
  if (!tokenResp.ok) {
    const t = await tokenResp.text();
    log('Failed to fetch session: ' + t);
    startBtn.disabled = false;
    statusEl.textContent = 'error';
    return;
  }
  const sessionJson = await tokenResp.json();
  dlog('[client] /session response', sessionJson);
  const { client_secret, model } = sessionJson;
  if (!client_secret) {
    log('No client_secret in response');
    startBtn.disabled = false;
    statusEl.textContent = 'error';
    return;
  }

  // Capture microphone
  dlog('[client] requesting userMedia');
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  dlog('[client] got userMedia tracks', localStream.getTracks().map(t => t.kind));

  // Prepare RTCPeerConnection
  pc = new RTCPeerConnection();
  dlog('[webrtc] RTCPeerConnection created');

  // Show remote audio
  pc.ontrack = (e) => {
    dlog('[webrtc] ontrack', { streams: e.streams?.length });
    if (remoteAudio.srcObject !== e.streams[0]) {
      remoteAudio.srcObject = e.streams[0];
    }
  };
  // Add local mic tracks
  localStream.getTracks().forEach(track => {
    dlog('[webrtc] adding local track', track.kind);
    pc.addTrack(track, localStream);
  });

  // Data channel
  dataChannel = pc.createDataChannel('oai-events');
  dlog('[webrtc] data channel created');
  dataChannel.onopen = () => {
    log('data channel open');
    dlog('[webrtc] data channel state', dataChannel.readyState);
    const turnDetection = {
      type: 'server_vad',
      threshold: 0.5,
      silence_duration_ms: 600,
    };
    const updateMsg = { 
      type: 'session.update', 
      session: { 
        turn_detection: turnDetection,
        input_audio_transcription: {
          model: 'whisper-1'
        },
        modalities: ['text', 'audio']
      } 
    };
    dlog('[->api] session.update', updateMsg);
    dataChannel.send(JSON.stringify(updateMsg));
  };
  dataChannel.onmessage = (evt) => {
    let payload;
    try { payload = JSON.parse(evt.data); }
    catch { dlog('[api->] non-JSON message', evt.data); return; }

    dlog('[api->] event', payload.type, payload);

    switch (payload.type) {
      // User speech events
      case 'input_audio_transcription.delta':
      case 'input_audio_buffer.speech_started':
      case 'conversation.item.input_audio_transcription.delta':
      case 'transcript.delta': {
        const chunk = payload.delta || payload.text || payload.transcript || '';
        dlog('[transcript] user delta:', chunk);
        if (chunk) updateTranscriptWithDebounce('user', chunk);
        break;
      }
      case 'input_audio_transcription.completed':
      case 'conversation.item.input_audio_transcription.completed':
      case 'transcript.completed': {
        const finalText = payload.transcript || payload.text || undefined;
        dlog('[transcript] user completed:', finalText);
        if (finalText) updateTranscriptWithDebounce('user', finalText, true);
        break;
      }
      // Assistant response events
      case 'response.text.delta':
      case 'response.audio_transcript.delta':
      case 'response.delta':
      case 'response.output_text.delta': {
        const chunk = payload.delta || payload.text || payload.transcript || '';
        dlog('[transcript] assistant delta:', chunk);
        if (chunk) updateTranscriptWithDebounce('assistant', chunk);
        break;
      }
      case 'response.text.done':
      case 'response.audio_transcript.done':
      case 'response.completed':
      case 'response.output_text.done':
      case 'response.done': {
        const finalText = extractTextFromResponseCompleted(payload);
        dlog('[transcript] extracted assistant text:', finalText);
        if (finalText) updateTranscriptWithDebounce('assistant', finalText, true);
        break;
      }
      case 'error':
      case 'response.error': {
        log('Error: ' + (payload.error?.message || JSON.stringify(payload)), 'assistant');
        break;
      }
      default: {
        // Log unknown events to help identify what's coming through
        if (payload.type && (payload.type.includes('audio') || payload.type.includes('transcript') || payload.type.includes('text'))) {
          dlog('[unhandled event]', payload.type, payload);
        }
      }
    }
  };
  dataChannel.onclose = () => dlog('[webrtc] data channel closed');
  dataChannel.onerror = (e) => log('DataChannel error: ' + e.message);

  // Create SDP offer & start WebRTC handshake with OpenAI
  dlog('[webrtc] creating offer');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  dlog('[webrtc] localDescription set, length', offer.sdp?.length);

  const sdpUrl = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model || 'gpt-realtime')}`;
  dlog('[->api] POST', sdpUrl, '(SDP omitted)');
  const sdpResponse = await fetch(sdpUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${client_secret}`,
      'Content-Type': 'application/sdp'
    },
    body: offer.sdp
  }).catch(err => {
    log('SDP POST failed: ' + err.message);
    throw err;
  });
  dlog('[api->] SDP status', sdpResponse.status);
  const answerSdp = await sdpResponse.text();
  dlog('[api->] SDP answer length', answerSdp.length);

  const answer = { type: 'answer', sdp: answerSdp };
  await pc.setRemoteDescription(answer);
  dlog('[webrtc] remoteDescription set');

  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = 'connected';
  log('Connected to OpenAI Realtime (' + (model || 'gpt-realtime') + ')');
}

async function stop() {
  stopBtn.disabled = true;
  statusEl.textContent = 'stopping…';

  // Flush any pending transcript updates before stopping
  if (transcriptTimeouts.user) {
    clearTimeout(transcriptTimeouts.user);
    if (transcriptBuffer.user) {
      const live = getOrCreateLiveLine('user');
      if (live) live.textContent = transcriptBuffer.user;
      finalizeLiveLine('user', transcriptBuffer.user);
    }
  }
  if (transcriptTimeouts.assistant) {
    clearTimeout(transcriptTimeouts.assistant);
    if (transcriptBuffer.assistant) {
      const live = getOrCreateLiveLine('assistant');
      if (live) live.textContent = transcriptBuffer.assistant;
      finalizeLiveLine('assistant', transcriptBuffer.assistant);
    }
  }

  try {
    if (dataChannel && dataChannel.readyState === 'open') dataChannel.close();
  } catch {}
  try {
    if (pc) pc.close();
  } catch {}

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  pc = null;
  localStream = null;
  dataChannel = null;

  startBtn.disabled = false;
  statusEl.textContent = 'idle';
  log('Disconnected');
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
if (clearLogBtn) clearLogBtn.addEventListener('click', () => { logEl.innerHTML = ''; });
