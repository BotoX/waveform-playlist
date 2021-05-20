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
      var wanted = "DEMOPUSHEADER_V2";
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
    var promises = [];

    const view = new DataView(demopusData);
    var ofs = 16; // skip header

    var channels = 1;
    var sampleRate = view.getUint32(ofs, true);
    ofs += 4;
    var numSamples = Number(view.getBigUint64(ofs, true));
    ofs += 8;

    // output sample rate != input sample rate
    numSamples *= (this.ac.sampleRate / sampleRate);
    var audioBuffer = this.ac.createBuffer(channels, numSamples, this.ac.sampleRate);

    while (ofs < demopusData.byteLength) {
      var samplesOfs = Number(view.getBigUint64(ofs, true));
      ofs += 8;
      samplesOfs *= (this.ac.sampleRate / sampleRate);

      if (ofs >= demopusData.byteLength) {
        break;
      }

      var dataLen = view.getUint32(ofs, true);
      ofs += 4;

      var opusData = demopusData.slice(ofs, ofs + dataLen);
      ofs += dataLen;

      var promise = this.ac.decodeAudioData(
        opusData,
        function(decoded) {
          var buf = decoded.getChannelData(0);
          audioBuffer.copyToChannel(buf, 0, this);
          return decoded.length;
        }.bind(samplesOfs),
        (err) => {
          if (err === null) {
            // Safari issues with null error
            return Error('MediaDecodeAudioDataUnknownContentType');
          } else {
            return err;
          }
        },
      );

      promises.push(promise);
    }

    return new Promise((resolve, reject) => {
      Promise.all(promises).then(result => {
        this.setStateChange(STATE_FINISHED);
        resolve(audioBuffer);
      });
    });
  }
}
