document.addEventListener("DOMContentLoaded", () => {
  // --- Global Variables ---
  let audioContext = null;
  let originalStream = null;
  let recorder = null;
  let ggwave = null;
  let instance = null;
  let parameters = null;
  let analyser = null;
  let animationFrameId = null;

  // --- (DOM Elements) ---
  const txData = document.getElementById("txData");
  const rxData = document.getElementById("rxData");
  const btnSend = document.getElementById("btnSend");
  const btnStartCapture = document.getElementById("btnStartCapture");
  const btnStopCapture = document.getElementById("btnStopCapture");
  const statusDiv = document.getElementById("status");
  const canvas = document.getElementById("visualizerCanvas");
  const canvasCtx = canvas.getContext("2d");

  // --- Initialitate GGWave Module ---
  ggwave_factory()
    .then((obj) => {
      ggwave = obj;
      updateStatus("Siap digunakan", "idle");
    })
    .catch((error) => {
      console.error("Gagal memuat modul ggwave:", error);
      updateStatus("Error: Gagal memuat modul ggwave", "error");
    });

  // --- Helper Functions ---
  const updateStatus = (message, type) => {
    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`;
  };

  const convertTypedArray = (src, type) => {
    const buffer = new ArrayBuffer(src.byteLength);
    new src.constructor(buffer).set(src);
    return new type(buffer);
  };

  const initAudioContext = () => {
    if (!audioContext) {
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContext({ sampleRate: 48000 });
    }
  };

  function setupVisualizer() {
    if (!analyser) {
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
    }
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    function draw() {
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);
      canvasCtx.fillStyle = "#1a1a2a";
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = "#6a5acd";
      canvasCtx.beginPath();
      const sliceWidth = (canvas.width * 1.0) / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);
        x += sliceWidth;
      }
      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    }
    draw();
  }

  function stopVisualizer() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    setTimeout(() => {
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    }, 100);
  }

  // --- (TRANSMIT) ---
  btnSend.addEventListener("click", () => {
    initAudioContext();
    if (!instance) {
      parameters = ggwave.getDefaultParameters();
      parameters.sampleRateOut = audioContext.sampleRate;
      instance = ggwave.init(parameters);
    }
    if (recorder) {
      btnStopCapture.click();
    }
    const payload = txData.value;
    if (payload.length === 0) {
      alert("Pesan kosong.");
      return;
    }
    updateStatus("Mengirim suara...", "listening");
    btnSend.disabled = true;

    const waveform = ggwave.encode(
      instance,
      payload,
      ggwave.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST,
      10,
    );
    const buf = convertTypedArray(waveform, Float32Array);
    const buffer = audioContext.createBuffer(
      1,
      buf.length,
      audioContext.sampleRate,
    );
    buffer.getChannelData(0).set(buf);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    setupVisualizer();
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    source.start(0);
    source.onended = () => {
      stopVisualizer();
      updateStatus("Menunggu perintah...", "idle");
      btnSend.disabled = false;
    };
  });

  // --- (RECEIVE) ---
  btnStartCapture.addEventListener("click", () => {
    if (!ggwave) {
      alert("Modul ggwave belum dimuat.");
      return;
    }
    initAudioContext();
    if (!instance) {
      parameters = ggwave.getDefaultParameters();
      parameters.sampleRateInp = audioContext.sampleRate;
      instance = ggwave.init(parameters);
    }
    updateStatus("Meminta izin mikrofon...", "listening");

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // Save original stream
        originalStream = stream;

        const mediaStreamSource =
          audioContext.createMediaStreamSource(originalStream);
        setupVisualizer();
        mediaStreamSource.connect(analyser);
        updateStatus("Mendengarkan...", "listening");

        btnStartCapture.classList.add("hidden");
        btnStopCapture.classList.remove("hidden");

        const bufferSize = 1024;
        recorder = audioContext.createScriptProcessor(bufferSize, 1, 1);

        recorder.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const audioBuffer = convertTypedArray(
            new Float32Array(inputData),
            Int8Array,
          );
          const res = ggwave.decode(instance, audioBuffer);

          if (res && res.length > 0) {
            const receivedText = new TextDecoder("utf-8").decode(res);
            rxData.value = receivedText;
            updateStatus("Pesan berhasil diterima!", "success");
            btnStopCapture.click();
          }
        };

        analyser.connect(recorder);
      })
      .catch((error) => {
        console.error("Gagal mengakses mikrofon:", error);
        updateStatus("Gagal mengakses mikrofon!", "error");
      });
  });

  btnStopCapture.addEventListener("click", () => {
    if (recorder) {
      stopVisualizer();
      recorder.disconnect();
      recorder = null;
    }
    if (originalStream) {
      originalStream.getTracks().forEach((track) => track.stop());
      originalStream = null;
    }
    updateStatus("Menunggu perintah...", "idle");
    btnStartCapture.classList.remove("hidden");
    btnStopCapture.classList.add("hidden");
  });
});
