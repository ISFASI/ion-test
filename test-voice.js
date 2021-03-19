let voiceService = null;
const resourceName = 'test-voice';
const urlSFU = 'wss://_CHANGE_ME_/ws';

const responses = {
  changeStateConnection: `https://${resourceName}/changeStateConnection`,
  requestMediaPeerResponse: `https://${resourceName}/requestMediaPeerResponse`,
  requestCloseMediaPeerResponse: `https://${resourceName}/requestCloseMediaPeerResponse`
}

class VoiceService {
  constructor() {
    this.mainContext = new AudioContext();
    this.mainVolume = this.mainContext.createGain();

    this.mainVolume.connect(this.mainContext.destination);
    this.mainVolume.gain.setValueAtTime(1, this.mainContext.currentTime);

    this._listenRooms = new Map();

    this._producerSid;
    this._producer;
    this.localStream;

    this.config = {
      iceServers: [
        {urls: "stun:stun.l.google.com:19302"},
      ]
    };
  }

  addProducer(sid) {
    const signal = new Signal.IonSFUJSONRPCSignal(
      urlSFU
    );

    this._producerSid = sid;

    this._producer = new IonSDK.Client(signal, this.config);
    signal.onopen = async () => {
      await this._producer.join(sid + "room", sid);

      IonSDK.LocalStream.getUserMedia({
        video: false,
        audio: true,
        // sendEmptyOnMute: true
      })
        .then((media) => {
          console.log('GET MEDIA', media);
          this.localStream = media;
          this._producer.publish(media);
          this.mute();
          this.responseInit('connected');
        })
        .catch((error) => {
          console.log(error);
          this.responseInit('loading');
        });
    };
  }

  addRoom(sid) {
    const signal = new Signal.IonSFUJSONRPCSignal(
      urlSFU
    );

    const listener = new IonSDK.Client(signal, this.config);
    signal.onopen = async () => {
      try {
        await listener.join(sid + "room", this._producerSid);

        listener.ontrack = (track, stream) => {
          console.log("got track", track, "for stream", stream);
  
          track.onunmute = () => {
            const consumer = {}
  
            const audio = new Audio();
            audio.autoplay = false;
            audio.volume = 0;
            audio.srcObject = stream;
  
            const source = this.mainContext.createMediaStreamSource(stream);
  
            // GainNode (proximity)
            consumer.gainNode = this.mainContext.createGain();
            source.connect(consumer.gainNode);
            consumer.gainNode.connect(this.mainVolume);
            consumer.gainNode.gain.setValueAtTime(0, this.mainContext.currentTime);
  
            // PannerNode (stereo)
            const panner = this.mainContext.createPanner();
            consumer.panner = panner;
            consumer.gainNode.connect(consumer.panner);
            consumer.panner.connect(this.mainVolume);
            consumer.panner.setOrientation(0, 0, 1);
  
            consumer.streamSource = source;
  
            stream.onremovetrack = () => {
              // this.delRoom(sid);
            };
  
            this._listenRooms.set(sid, {
              listener: listener,
              consumer: consumer
            });
  
            this.responseStreamIn(sid, true);
          };
        };
      } catch (error) {
        console.log(error);
        this.responseStreamIn(sid, false);
      }
    };
  }

  delRoom(sid) {
    const roomData = this._listenRooms.get(sid);

    if (roomData) {
      const consumer = roomData.consumer;
      const listener = roomData.listener;

      consumer.gainNode.disconnect(this.mainVolume);
      consumer.streamSource.disconnect(consumer.gainNode);
      consumer.gainNode.disconnect(consumer.panner);
      consumer.panner.disconnect(this.mainVolume);

      listener.close();

      this._listenRooms.delete(sid);
      this.responseStreamOut(sid, true);
    } else {
      this.responseStreamOut(sid, false);
    }
  }

  changeConsumerVolume(sid, volume, balance) {
    const roomData = this._listenRooms.get(sid);

    if (roomData) {
      const consumer = roomData.consumer;
      if (consumer) {
        if (typeof consumer.gainNode !== 'undefined' && typeof consumer.gainNode.gain !== 'undefined' && !isNaN(volume)) {
          consumer.gainNode.gain.setValueAtTime(volume, this.mainContext.currentTime);
        }

        if (typeof consumer.panner !== 'undefined' && !isNaN(balance)) {
          consumer.panner.setPosition(balance, 0, (1 - Math.abs(balance)));
        }
      }
    }

  }

  changeConsumersVolume(peersData) {
    peersData.forEach(peerData => {
      this.changeConsumerVolume(peerData.name, peerData.volume, peerData.balance);
    });
  }

  mute() {
    this.localStream.mute('audio');
  }

  unmute() {
    this.localStream.unmute('audio');
  }

  deconstruct() {
    this._producer.close();
    this._listenRooms.forEach((val, sid, map) => this.delRoom(sid));
  }

  responseInit(state) {
    fetch(responses.changeStateConnection, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        state: state
      })
    });
  }

  responseStreamIn(peerName, status) {
    fetch(responses.requestMediaPeerResponse, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        peerName: peerName,
        status: status
      })
    });
  }

  responseStreamOut(peerName, status) {
    fetch(responses.requestCloseMediaPeerResponse, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        peerName: peerName,
        status: status
      })
    });
  }
}

// public endpoints

start = (sid) => {
  if (voiceService) {
    voiceService.deconstruct();
    delete voiceService;
  }

  voiceService = new VoiceService();
  voiceService.addProducer(sid);
}

streamIn = (peerName) => {
  voiceService.addRoom(peerName);
}

streamOut = (peerName) => {
  voiceService.delRoom(peerName);
}

changePosition = (peersData) => {
  voiceService.changeConsumersVolume(peersData);
}

mute = () => {
  voiceService.mute();
}

unmute = () => {
  voiceService.unmute();
}

window.addEventListener("message", (event) => {
  let e = event.data;

  switch (e.type) {
    case 'init':
      start(e.args[0]);
      break;
  
    case 'streamIn':
      streamIn(e.args[0]);
      break;

    case 'streamOut':
      streamOut(e.args[0]);
      break;

    case 'changeVolumeConsumers':
      changePosition(e.args[0]);
      break;

    case 'muteMic':
      mute();
      break;

    case 'unmuteMic':
      unmute();
      break;

    default:
      break;
  }
});

console.log('HELLO FROM VOICE');