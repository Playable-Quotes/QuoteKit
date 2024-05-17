
/*
    This Frida script attempts to implement our plumbing API design for the Bochs emulator.

    Methods:
        getDeviceInfo() -> obj containing name, block size, and block count for devices
        saveResidue() -> ArrayBuffer
        restoreResidue(buffer)
        readBlock(device,index) -> ArrayBuffer
        writeBlock(device,index,buffer)
        resetBlockNotifications(device)
        applyStimulus(obj)
    Events:
        main-loop: no details
        frame: visual animation frame, details pixels
        read-block: details device id and block index
        write-block: details device id and block index
        stimulus: details an environmental stimulus object
*/

/*
    To use this script, first launch the Bochs emulator:
    
            $ bochs -q -f bochsrc.txt
    
        Then, launch this script with Frida:
    
            $ frida -l bochs-plumbing.js bochs
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

    const eventTarget = new EventTarget();

    function lookup(name) {
        return ptr(DebugSymbol.fromName(name).address);
    }


    Interceptor.attach(lookup("BX_CPU_C::handleAsyncEvent()"), function () {
        eventTarget.dispatchEvent({
            type: "main-loop"
        });
    });

    const bx_mem = Module.getExportByName("bochs", "bx_mem");
    const get_memory_len = new NativeFunction(lookup("BX_MEMORY_STUB_C::get_memory_len()"), "size_t", ["pointer"]);
    const mem_size = get_memory_len(bx_mem).toNumber();
    const memory_block_size = 16384;
    const num_memory_blocks = mem_size / memory_block_size;
    const mem_already_read = new Uint8Array(mem_size);
    const mem_already_written = new Uint8Array(mem_size);

    const bx_cpu = Module.getExportByName("bochs", "bx_cpu");

    Interceptor.attach(lookup("BX_MEM_C::readPhysicalPage(BX_CPU_C*, unsigned long, unsigned int, void*)"), function (args) {
        const addr = args[1];
        const block = Math.floor(addr / memory_block_size);
        if (!mem_already_read[block]) {
            mem_already_read[block] = 1;
            eventTarget.dispatchEvent({
                type: "read-block",
                device: "memory",
                index: block
            });
        }
    });

    Interceptor.attach(lookup("BX_MEM_C::writePhysicalPage(BX_CPU_C*, unsigned long, unsigned int, void*)"), function (args) {
        const addr = args[1];
        const block = Math.floor(addr / memory_block_size);
        if (!mem_already_written[block]) {
            mem_already_written[block] = 1;
            eventTarget.dispatchEvent({
                type: "write-block",
                device: "memory",
                index: block
            });
        }
    });

    function resetMemoryBlockNotifications() {
        mem_already_read.fill(0);
        mem_already_written.fill(0);
    }

    let last_disk_offset = null;
    const disk_size = uint64("0x100000000"); // TODO: somehow determine the size of the disk image
    const disk_block_size = 16384;
    const num_disk_blocks = disk_size / disk_block_size;
    const disk_blocks_already_read = new Uint8Array(num_disk_blocks);
    const disk_blocks_already_written = new Uint8Array(num_disk_blocks);

    Interceptor.attach(lookup("flat_image_t::lseek(long, int)"), function (args) {
        last_disk_offset = args[1];
    });

    Interceptor.attach(lookup("flat_image_t::read(void*, unsigned long)"), function (args) {
        let count = args[2];
        let block = Math.floor(last_disk_offset / disk_block_size);
        if (!disk_blocks_already_read[block]) {
            disk_blocks_already_read[block] = 1;
            eventTarget.dispatchEvent({
                type: "read-block",
                device: "disk",
                index: block
            });
        }
        last_disk_offset = last_disk_offset.add(count);
    });


    Interceptor.attach(lookup("flat_image_t::write(void const*, unsigned long)"), function (args) {
        let count = args[2];
        let block = Math.floor(last_disk_offset / disk_block_size);
        if (!disk_blocks_already_written[block]) {
            disk_blocks_already_written[block] = 1;
            eventTarget.dispatchEvent({
                type: "write-block",
                device: "disk",
                index: block
            });
        }
        last_disk_offset = last_disk_offset.add(count);
    });

    function resetDiskBlockNotifications() {
        disk_blocks_already_read.fill(0);
        disk_blocks_already_written.fill(0);
    }

    function resetBlockNotifications(device) {
        if (device === "memory") {
            resetMemoryBlockNotifications();
        } else if (device === "disk") {
            resetDiskBlockNotifications();
        } else {
            throw new Error("Unknown device: " + device);
        }
    }

    function getDeviceInfo() {
        return {
            memory: {
                name: "memory",
                block_size: memory_block_size,
                block_count: num_memory_blocks
            },
            disk: {
                name: "disk",
                block_size: disk_block_size,
                block_count: -1
            }
        };
    }

    Interceptor.attach(lookup("bx_devices_c::gen_scancode(unsigned int)"), {
        onEnter(args) {
            const key = args[1].toInt32();
            eventTarget.dispatchEvent({
                type: "stimulus",
                device: "keyboard",
                key
            });
        }
    });

    Interceptor.attach(lookup("bx_devices_c::mouse_motion(int, int, int, unsigned int, bool)"), {
        onEnter(args) {
            const dx = args[1].toInt32();
            const dy = args[2].toInt32();
            const dz = args[3].toInt32();
            const button_state = args[4].toInt32();
            eventTarget.dispatchEvent({
                type: "stimulus",
                device: "mouse",
                dx,
                dy,
                dz,
                button_state
            });
        }
    });

    const SIM = Module.getExportByName("bochs", "SIM").readPointer();
    function param_name(param) { return param.add(24).readPointer().readUtf8String(); };

    const save_state = new NativeFunction(
        lookup("bx_real_sim_c::save_state(char const*)"),
        'bool', ['pointer'/* bx_real_sim_c* this */, 'pointer'/* const char *checkpoint_path */]);

    const save_sr_param = new NativeFunction(
        lookup("bx_real_sim_c::save_sr_param(__sFILE*, bx_param_c*, char const*, int)"),
        'bool',
        ['pointer'/* bx_real_sim_c* this */, 'pointer'/* FILE* fp */, 'pointer'/* bx_param_c* node */, 'pointer'/* char const* sr_path */, 'int'/* level */]);

    Interceptor.replace(
        lookup("bx_real_sim_c::save_sr_param(__sFILE*, bx_param_c*, char const*, int)"),
        new NativeCallback(function (_this, fp, node, sr_path, level) {
            const name = param_name(node);
            console.log("save_sr_param", name);
            if (level == 0 && (name == 'hard_drive' || name == 'memory')) {
                // just don't
                return 0;
            }
            return save_sr_param(_this, fp, node, sr_path, level);
        }, 'bool', ['pointer', 'pointer', 'pointer', 'pointer', 'int']));

    function saveResidue() {
        const _fopen = Interceptor.attach(lookup("fopen"), {
            onEnter(args) {
                console.log("fopen", args[0].readUtf8String());
            },
            onLeave(retval) {
                console.log("fopen ->", retval);
            }
        });
        const _fwrite = Interceptor.attach(lookup("fwrite"), {
            onEnter(args) {
                console.log("fseek", args[1]);
            },
            onLeave(retval) {
                console.log("fseek ->", retval);
            }
        });

        save_state(SIM, Memory.allocUtf8String("checkpoint"));

        _fopen.detach();
        _fwrite.detach();
        return { byteLength: -1 };
    }

    function restoreResidue(buffer) {
        // TODO: implement
    }

    // Missing plumbing API methods:
    // - saveResidue
    // - restoreResidue
    // - readBlock
    // - writeBlock
    // - applyStimulus

    // Missing plumbing API events:
    // - frame

    globalThis.QuoteKit = {
        addEventListener: eventTarget.addEventListener.bind(eventTarget),
        removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
        getDeviceInfo,
        resetBlockNotifications,
        saveResidue,
        restoreResidue,
    };

})();