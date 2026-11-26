// Copies microphone samples to the main thread so the response can be saved as a WAV.
class SSAPRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('ssap-rec', SSAPRecorder);
