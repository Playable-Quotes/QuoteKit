/*
This API is meant to be implemented in an environment like Frida or the browser where the code is executed inside the same process that hosts the actual emulator and events as dispatched synchronously (e.g. the state is not changing during the saving of a residue).

Methods:
    *getDeviceInfo() -> obj containing name, block size, and block count for devices
    saveResidue() -> ArrayBuffer
    restoreResidue(buffer)
    readBlock(device,index) -> ArrayBuffer
    writeBlock(device,index,buffer)
    resetBlockNotifications()
    applyStimulus(obj)
Events:
    main-loop: details nothing
    frame: visual animation frame, details pixels
    read-block: details device id and block index
    write-block: details device id and block index
    stimulus: details an environmental stimulus object

*/

(function () {
  "use strict";
  class EventTarget {
    constructor() {
      this.listeners = {};
    }
    addEventListener(type, listener) {
      if (!(type in this.listeners)) {
        this.listeners[type] = [];
      }
      this.listeners[type].push(listener);
    }
    removeEventListener(type, listener) {
      if (!(type in this.listeners)) {
        return;
      }
      const index = this.listeners[type].indexOf(listener);
      if (index !== -1) {
        this.listeners[type].splice(index, 1);
      }
    }
    dispatchEvent(event) {
      if (!(event.type in this.listeners)) {
        return;
      }
      for (let listener of this.listeners[event.type]) {
        listener.call(this, event);
      }
    }
  }

  function saveResidue() {
    let retro_serialize_size_addr = DebugSymbol.fromName(
      "retro_serialize_size"
    ).address;
    let retro_serialize_addr = DebugSymbol.fromName("retro_serialize").address;

    const retro_serialize_size = new NativeFunction(
      retro_serialize_size_addr,
      "size_t",
      []
    );
    const retro_serialize = new NativeFunction(retro_serialize_addr, "bool", [
      "pointer",
      "size_t",
    ]);

    const size = retro_serialize_size();
    const dataPointer = Memory.alloc(size);
    retro_serialize(dataPointer, size);
    return dataPointer.readByteArray(size);
  }

  function restoreResidue(buffer) {
    let retro_unserialize_addr =
      DebugSymbol.fromName("retro_unserialize").address;

    const retro_unserialize = new NativeFunction(
      retro_unserialize_addr,
      "bool",
      ["pointer", "size_t"]
    );

    const dataPointer = Memory.alloc(buffer.byteLength);
    dataPointer.writeByteArray(buffer);
    return retro_unserialize(dataPointer, buffer.byteLength);
  }

  Interceptor.attach(
    DebugSymbol.fromName("input_driver_state_wrapper").address,
    {
      onEnter(args) {
        const port = args[0].toInt32();
        const device = args[1].toInt32();
        const index = args[2].toInt32();
        const id = args[3].toInt32();

        this.event = {
          type: "stimulus",
          port,
          device,
          index,
          id,
        };
      },
      onLeave(retval) {
        this.event.retval = retval.toInt32();
        eventTarget.dispatchEvent(this.event);
      },
    }
  );

  function getDeviceInfo() {
    return {
      ram: {
        name: "RAM",
        block_size: -1,
        block_count: -1,
      },
      rom: {
        name: "ROM",
        block_size: -1,
        block_count: -1,
      },
    };
  }

  const eventTarget = new EventTarget();

  const funcAddr = DebugSymbol.fromName("retro_run").address;
  Interceptor.attach(funcAddr, function () {
    eventTarget.dispatchEvent({ type: "main-loop" });
  });

  globalThis.QuoteKit = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    getDeviceInfo,
    saveResidue,
    restoreResidue,
  };
})();
