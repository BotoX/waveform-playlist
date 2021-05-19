import EventEmitter from 'event-emitter';

export const STATE_UNINITIALIZED = 0;
export const STATE_LOADING = 1;
export const STATE_DECODING = 2;
export const STATE_FINISHED = 3;


export default class {
  constructor(src, audioContext, ee = EventEmitter()) {
    this.src = src;
    this.ac = audioContext;
    this.audioRequestState = STATE_UNINITIALIZED;
    this.ee = ee;
  }

  setStateChange(state) {
    this.audioRequestState = state;
    this.ee.emit('audiorequeststatechange', this.audioRequestState, this.src);
  }

  fileProgress(e) {
    let percentComplete = 0;

    if (this.audioRequestState === STATE_UNINITIALIZED) {
      this.setStateChange(STATE_LOADING);
    }

    if (e.lengthComputable) {
      percentComplete = (e.loaded / e.total) * 100;
    }

    this.ee.emit('loadprogress', percentComplete, this.src);
  }

  fileLoad(e) {
    const audioData = e.target.response || e.target.result;

    if(audioData.byteLength > 16) {
      var view = new DataView(audioData);
      var wanted = "DEMOPUSHEADER_V1";
      var success = true;
      for(var i = 0, n = 16; i < n; i++) {
        var c = view.getUint8(i);
        if (c != wanted.charCodeAt(i)) {
          success = false;
        }
      }
      if(success) {
        return this.fileLoad_custom(audioData);
      }
    }

    this.setStateChange(STATE_DECODING);

    return new Promise((resolve, reject) => {
      this.ac.decodeAudioData(
        audioData,
        (audioBuffer) => {
          this.audioBuffer = audioBuffer;
          this.setStateChange(STATE_FINISHED);

          resolve(audioBuffer);
        },
        (err) => {
          if (err === null) {
            // Safari issues with null error
            reject(Error('MediaDecodeAudioDataUnknownContentType'));
          } else {
            reject(err);
          }
        },
      );
    });
  }

  fileLoad_custom(demopusData) {
    this.setStateChange(STATE_DECODING);

    var parsed = [];
    var sampleRate = 0;
    var numSamples = 0;
    var channels = 1;

    const view = new DataView(demopusData);
    var ofs = 16; // skip header

    while (ofs < demopusData.byteLength) {
      var header = view.getUint8(ofs);
      ofs += 1;

      if (header == 0x02) { // opus
        var dataLen = Number(view.getBigUint64(ofs, true));
        ofs += 8;
        var opusData = demopusData.slice(ofs, ofs + dataLen);
        ofs += dataLen;

        var promise = this.ac.decodeAudioData(
          opusData,
          (audioBuffer) => {
            return audioBuffer;
          },
          (err) => {
            if (err === null) {
              // Safari issues with null error
              return Error('MediaDecodeAudioDataUnknownContentType');
            } else {
              return err;
            }
          },
        );

        parsed.push(promise);
      }

      else if (header == 0x03) { // silence
        var samples = Number(view.getBigUint64(ofs, true));
        ofs += 8;
        parsed.push(samples);
      }

      else if (header == 0x01) { // info
        sampleRate = view.getUint32(ofs, true);
        ofs += 4;
        numSamples = Number(view.getBigUint64(ofs, true));
        ofs += 8;
      }

      else if (header == 0x04) { // done
        break;
      }
    }

    return new Promise((resolve, reject) => {
      // output sample rate != input sample rate
      numSamples *= (this.ac.sampleRate / sampleRate);
      var audioBuffer = this.ac.createBuffer(channels, numSamples, this.ac.sampleRate);

      return Promise.all(parsed).then(result => {
        var curSamples = 0;

        for (var i = 0; i < result.length; i++) {
          var elem = result[i];
          if (typeof(elem) == "number") {
            curSamples += elem * (this.ac.sampleRate / sampleRate);
          } else {
            var buf = elem.getChannelData(0);
            audioBuffer.copyToChannel(buf, 0, curSamples);
            curSamples += elem.length;
          }
        }

        this.setStateChange(STATE_FINISHED);
        resolve(audioBuffer);
      });
    });
  }
}
