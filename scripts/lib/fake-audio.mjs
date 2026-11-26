// 이펙터 시험용 가짜 오디오 노드(S4.7).
//
// 예전 시험은 이펙터 소스 파일을 글자로 읽어 `/oscillator\.connect\(slewFilter\)/` 같은 정규식으로 확인했다.
// 소스를 어떻게 쓰든 같은 소리를 내면 통과해야 하고, 소리가 달라지면 실패해야 한다. 그래서 이 도구는 진짜 이펙터 클래스를
// 그대로 돌리면서 **무슨 일이 일어났는지** 를 기록한다 — 어떤 노드가 만들어졌고, 어디에서 어디로 이어졌고, 각 파라미터에
// 어떤 값이 어떤 방법으로 쓰였는지. 시험은 그 기록(그래프 모양·값)을 묻는다.
//
// 쓰는 법:
//   const fake = installFakeAudio();            // globalThis 에 GainNode 등을 깐다
//   const context = fake.createContext({ currentTime: 0.25 });
//   const effect = new SomeEffect(context, pedal);
//   fake.created('GainNode')                   // 만들어진 노드 목록
//   fake.pathExists(a, b)                      // a 에서 b 로 이어졌는지(중간 노드 거쳐도 됨)
//   param.directAssignments                    // `.value = …` 로 직접 쓴 횟수(0 이어야 한다 — 클릭 소리의 원인)
//   param.automation                           // 예약 호출 기록
/** 파라미터. `.value` 에 직접 쓰면 `directAssignments` 가 올라간다(예약 메서드는 올리지 않는다). */
export class FakeParam {
  #value;

  constructor(value = 0, name = '') {
    this.#value = value;
    this.name = name;
    this.directAssignments = 0;
    this.automation = [];
  }

  get value() {
    return this.#value;
  }

  set value(next) {
    this.directAssignments += 1;
    this.#value = next;
  }

  /** 예약 호출을 기록하고 값을 곧바로 목표로 옮긴다(시험은 최종 값을 본다). */
  #record(kind, value, time, extra) {
    this.automation.push({ kind, value, time, ...extra });
    if (Number.isFinite(value)) this.#value = value;
    return this;
  }

  setValueAtTime(value, time) { return this.#record('set', value, time); }
  linearRampToValueAtTime(value, time) { return this.#record('linear', value, time); }
  exponentialRampToValueAtTime(value, time) { return this.#record('exponential', value, time); }
  setTargetAtTime(value, time, timeConstant) { return this.#record('target', value, time, { timeConstant }); }
  setValueCurveAtTime(values, time, duration) { this.automation.push({ kind: 'curve', values, time, duration }); return this; }
  cancelScheduledValues(time) { this.automation.push({ kind: 'cancel', time }); return this; }
  cancelAndHoldAtTime(time) { this.automation.push({ kind: 'hold', time }); return this; }

  /** 예약 메서드로 값을 바꾼 횟수(취소·잡기는 제외). */
  get scheduledWrites() {
    return this.automation.filter((entry) => entry.kind !== 'cancel' && entry.kind !== 'hold').length;
  }
}

/** 이어진 곳을 `{ node, output, input }` 로 기록하는 노드 바탕. */
export class FakeNode {
  constructor(registry, kind) {
    this.kind = kind;
    this.registry = registry;
    this.edges = [];
    this.disconnectCalls = 0;
    this.disconnectedAll = false;
    registry.nodes.push(this);
  }

  connect(destination, output = 0, input = 0) {
    this.edges.push({ node: destination, output, input, param: destination instanceof FakeParam });
    return destination;
  }

  disconnect(destination) {
    this.disconnectCalls += 1;
    if (destination === undefined) {
      this.disconnectedAll = true;
      this.edges = [];
    } else {
      this.edges = this.edges.filter((edge) => edge.node !== destination);
    }
  }

  /** 이 노드에서 `target`(노드 또는 파라미터)으로 곧바로 이어졌는지. 출력·입력 번호를 주면 그것까지 같아야 한다. */
  connectsTo(target, { output, input } = {}) {
    return this.edges.some(
      (edge) =>
        edge.node === target &&
        (output === undefined || edge.output === output) &&
        (input === undefined || edge.input === input),
    );
  }
}

export function createFakeAudio() {
  const registry = { nodes: [], timers: [] };
  const classes = {};

  const define = (name, build) => {
    const NodeClass = class extends FakeNode {
      constructor(context, options = {}) {
        super(registry, name);
        this.context = context;
        this.options = options;
        build.call(this, options, context);
      }
    };
    Object.defineProperty(NodeClass, 'name', { value: name });
    classes[name] = NodeClass;
    return NodeClass;
  };

  define('GainNode', function build(options) {
    this.gain = new FakeParam(options.gain ?? 1, 'gain');
  });
  define('BiquadFilterNode', function build(options) {
    this.type = options.type ?? 'lowpass';
    this.frequency = new FakeParam(options.frequency ?? 350, 'frequency');
    this.Q = new FakeParam(options.Q ?? 1, 'Q');
    this.gain = new FakeParam(options.gain ?? 0, 'gain');
    this.detune = new FakeParam(options.detune ?? 0, 'detune');
  });
  define('DelayNode', function build(options) {
    this.delayTime = new FakeParam(options.delayTime ?? 0, 'delayTime');
    this.maxDelayTime = options.maxDelayTime ?? 1;
  });
  define('OscillatorNode', function build(options) {
    this.type = options.type ?? 'sine';
    this.frequency = new FakeParam(options.frequency ?? 440, 'frequency');
    this.detune = new FakeParam(options.detune ?? 0, 'detune');
    this.startTimes = [];
    this.stopTimes = [];
    this.started = false;
    this.onended = null;
  });
  classes.OscillatorNode.prototype.start = function start(when) {
    this.started = true;
    this.startTimes.push(when);
  };
  classes.OscillatorNode.prototype.stop = function stop(when) {
    this.stopTimes.push(when === undefined ? 'now' : when);
  };
  classes.OscillatorNode.prototype.setPeriodicWave = function setPeriodicWave(wave) { this.periodicWave = wave; };
  define('StereoPannerNode', function build(options) {
    this.pan = new FakeParam(options.pan ?? 0, 'pan');
  });
  define('ConstantSourceNode', function build(options) {
    this.offset = new FakeParam(options.offset ?? 1, 'offset');
    this.started = false;
  });
  classes.ConstantSourceNode.prototype.start = function start() { this.started = true; };
  classes.ConstantSourceNode.prototype.stop = function stop() {};
  define('WaveShaperNode', function build(options) {
    this.curve = options.curve ?? null;
    this.oversample = options.oversample ?? 'none';
  });
  define('ChannelSplitterNode', function build(options) {
    this.numberOfOutputs = options.numberOfOutputs ?? 6;
  });
  define('ChannelMergerNode', function build(options) {
    this.numberOfInputs = options.numberOfInputs ?? 6;
  });
  define('DynamicsCompressorNode', function build(options) {
    this.threshold = new FakeParam(options.threshold ?? -24, 'threshold');
    this.knee = new FakeParam(options.knee ?? 30, 'knee');
    this.ratio = new FakeParam(options.ratio ?? 12, 'ratio');
    this.attack = new FakeParam(options.attack ?? 0.003, 'attack');
    this.release = new FakeParam(options.release ?? 0.25, 'release');
    this.reduction = 0;
  });
  define('ConvolverNode', function build(options) {
    this.buffer = options.buffer ?? null;
    this.normalize = options.disableNormalization === undefined ? true : !options.disableNormalization;
  });
  // AudioWorkletNode(context, 이름, 옵션) 은 두 번째 인자가 이름이라 define() 을 쓰지 않고 따로 만든다.
  classes.AudioWorkletNode = class AudioWorkletNode extends FakeNode {
    constructor(context, processorName, options = {}) {
      super(registry, 'AudioWorkletNode');
      this.context = context;
      this.processorName = processorName;
      this.options = options;
      this.numberOfInputs = options.numberOfInputs ?? 1;
      this.numberOfOutputs = options.numberOfOutputs ?? 1;
      this.outputChannelCount = options.outputChannelCount;
      this.parameterData = options.parameterData ?? {};
      this.messages = [];
      this.port = {
        onmessage: null,
        messages: this.messages,
        postMessage: (message) => { this.messages.push(message); },
      };
      this.parameterMap = new Map();
      this.parameters = {
        get: (key) => {
          if (!this.parameterMap.has(key)) this.parameterMap.set(key, new FakeParam(this.parameterData[key] ?? 0, key));
          return this.parameterMap.get(key);
        },
      };
    }
  };
  Object.defineProperty(classes.AudioWorkletNode, 'name', { value: 'AudioWorkletNode' });

  const api = {
    classes,
    registry,
    /** `globalThis` 에 노드 클래스를 깐다. 되돌릴 함수를 돌려준다. */
    install() {
      const previous = {};
      for (const [name, NodeClass] of Object.entries(classes)) {
        previous[name] = globalThis[name];
        globalThis[name] = NodeClass;
      }
      return () => {
        for (const [name, value] of Object.entries(previous)) {
          if (value === undefined) delete globalThis[name];
          else globalThis[name] = value;
        }
      };
    },
    /** 이펙터가 받는 context. `createGain` 같은 팩토리도 같은 기록에 남는다. */
    createContext(overrides = {}) {
      const context = {
        currentTime: 0,
        sampleRate: 48_000,
        state: 'running',
        ...overrides,
      };
      const factory = (name) => (options) => new classes[name](context, options);
      context.createGain = factory('GainNode');
      context.createBiquadFilter = factory('BiquadFilterNode');
      context.createDelay = (maxDelayTime) => new classes.DelayNode(context, { maxDelayTime });
      context.createOscillator = factory('OscillatorNode');
      context.createStereoPanner = factory('StereoPannerNode');
      context.createConstantSource = factory('ConstantSourceNode');
      context.createWaveShaper = factory('WaveShaperNode');
      context.createChannelSplitter = (numberOfOutputs) => new classes.ChannelSplitterNode(context, { numberOfOutputs });
      context.createChannelMerger = (numberOfInputs) => new classes.ChannelMergerNode(context, { numberOfInputs });
      context.createDynamicsCompressor = factory('DynamicsCompressorNode');
      context.createConvolver = factory('ConvolverNode');
      context.createPeriodicWave = (real, imag, constraints) => ({ real, imag, constraints });
      return context;
    },
    /** 만들어진 노드(종류를 주면 그 종류만). */
    created(kind) {
      return kind ? registry.nodes.filter((node) => node.kind === kind) : [...registry.nodes];
    },
    /** 지금까지 만든 노드 수(update 가 노드를 새로 만들지 않는지 볼 때 앞뒤로 비교한다). */
    get nodeCount() {
      return registry.nodes.length;
    },
    /** `from` 에서 `to` 까지 이어지는 길이 있는지(중간에 다른 노드를 거쳐도 된다). 파라미터가 도착점일 수 있다. */
    pathExists(from, to) {
      const seen = new Set();
      const stack = [from];
      while (stack.length) {
        const node = stack.pop();
        if (seen.has(node)) continue;
        seen.add(node);
        for (const edge of node.edges ?? []) {
          if (edge.node === to) return true;
          if (edge.node instanceof FakeNode) stack.push(edge.node);
        }
      }
      return false;
    },
    /** 모든 파라미터를 모은다(직접 대입 횟수를 한꺼번에 볼 때). */
    allParams() {
      const params = [];
      for (const node of registry.nodes) {
        for (const value of Object.values(node)) if (value instanceof FakeParam) params.push(value);
        if (node.parameterMap) for (const value of node.parameterMap.values()) params.push(value);
      }
      return params;
    },
    directAssignments() {
      return api.allParams().reduce((sum, param) => sum + param.directAssignments, 0);
    },
  };
  return api;
}

/** 편의: 가짜를 만들어 바로 깔고, 되돌릴 `restore` 를 붙여 돌려준다. */
export function installFakeAudio() {
  const api = createFakeAudio();
  api.restore = api.install();
  return api;
}
