const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const remoteAudio = document.getElementById('remoteAudio');
const logEl = document.getElementById('log');

let pc, localStream, dataChannel;

function log(line, cls='') {
  const p = document.createElement('div');
  p.innerText = line;
  if (cls) p.className = cls;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
}

async function start() {
  startBtn.disabled = true;
  statusEl.textContent = 'starting…';

  // Get ephemeral token from our server
  const tokenResp = await fetch('/session');
  if (!tokenResp.ok) {
    const t = await tokenResp.text();
    log('Failed to fetch session: ' + t);
    startBtn.disabled = false;
    statusEl.textContent = 'error';
    return;
  }
  const { client_secret, model } = await tokenResp.json();
  if (!client_secret) {
    log('No client_secret in response');
    startBtn.disabled = false;
    statusEl.textContent = 'error';
    return;
  }

  // Capture microphone
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Prepare RTCPeerConnection
  pc = new RTCPeerConnection();
  // Show remote audio
  pc.ontrack = (e) => {
    if (remoteAudio.srcObject !== e.streams[0]) {
      remoteAudio.srcObject = e.streams[0];
    }
  };
  // Add local mic tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Optional: create a data channel so we can send session updates, log events, etc.
  dataChannel = pc.createDataChannel('oai-events');
  dataChannel.onopen = () => {
    log('data channel open');
    // Enable server-side VAD for continuous convo
    const turnDetection = {
      type: 'server_vad',
      threshold: 0.5,
      silence_duration_ms: 600,
      // prefix_padding_ms and max_pause_ms can also be tuned
    };
    // Push session.update to set VAD and (redundantly) reinforce instructions
    dataChannel.send(JSON.stringify({
      type: 'session.update',
      session: {
        turn_detection: turnDetection,
        // You can also tweak voice, temperature, etc. here.
      }
    }));
  };
  dataChannel.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      // Very lightweight logging of a few interesting server events
      if (msg.type === 'transcript.delta') {
        // Partial transcript text
        // log('You: ' + msg.delta, 'user');
      } else if (msg.type === 'response.delta') {
        // Partial assistant text
        // log('Bot: ' + msg.delta, 'assistant');
      } else if (msg.type === 'error') {
        log('Error: ' + (msg.error?.message || JSON.stringify(msg)), 'assistant');
      } else if (msg.type === 'response.completed') {
        // A single assistant turn finished
      }
    } catch {
      // not JSON, ignore
    }
  };

  // Create SDP offer & start WebRTC handshake with OpenAI
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model || 'gpt-realtime')}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${client_secret}`,
      'Content-Type': 'application/sdp'
    },
    body: offer.sdp
  });

  const answer = { type: 'answer', sdp: await sdpResponse.text() };
  await pc.setRemoteDescription(answer);

  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = 'connected';
  log('Connected to OpenAI Realtime (' + (model || 'gpt-realtime') + ')');
}

async function stop() {
  stopBtn.disabled = true;
  statusEl.textContent = 'stopping…';

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
