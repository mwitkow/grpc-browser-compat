import {Metadata} from "../metadata";
import {Transport, TransportOptions} from "./Transport";
import {debug} from "../debug";
import detach from "../detach";

export interface FetchTransportInit {
  credentials: "omit" | "same-origin" | "include"
}

export default function fetchRequest(options: TransportOptions, init: FetchTransportInit): Transport {
  options.debug && debug("fetchRequest", options);
  return new Fetch(options, init);
}

declare const Response: any;
declare const Headers: any;

class Fetch implements Transport {
  cancelled: boolean = false;
  options: TransportOptions;
  init: FetchTransportInit;
  reader: ReadableStreamReader;
  metadata: Metadata;
  controller: AbortController | undefined = (window as any).AbortController && new AbortController();

  constructor(transportOptions: TransportOptions, init: FetchTransportInit) {
    this.options = transportOptions;
    this.init = init;
  }

  pump(readerArg: ReadableStreamReader, res: Response) {
    this.reader = readerArg;
    if (this.cancelled) {
      // If the request was cancelled before the first pump then cancel it here
      this.options.debug && debug("Fetch.pump.cancel at first pump");
      this.reader.cancel();
      return;
    }
    this.reader.read()
      .then((result: { done: boolean, value: Uint8Array }) => {
        if (result.done) {
          detach(() => {
            this.options.onEnd();
          });
          return res;
        }
        detach(() => {
          this.options.onChunk(result.value);
        });
        this.pump(this.reader, res);
        return;
      })
      .catch(err => {
        if (this.cancelled) {
          this.options.debug && debug("Fetch.catch - request cancelled");
          return;
        }
        this.cancelled = true;
        this.options.debug && debug("Fetch.catch", err.message);
        detach(() => {
          this.options.onEnd(err);
        });
      });
  }

  send(msgBytes: Uint8Array) {
    fetch(this.options.url, {
      headers: this.metadata.toHeaders(),
      method: "POST",
      body: msgBytes,
      credentials: this.init.credentials,
      signal: this.controller && this.controller.signal
    }).then((res: Response) => {
      this.options.debug && debug("Fetch.response", res);
      detach(() => {
        this.options.onHeaders(new Metadata(res.headers as any), res.status);
      });
      if (res.body) {
        this.pump(res.body.getReader(), res)
        return;
      }
      return res;
    }).catch(err => {
      if (this.cancelled) {
        this.options.debug && debug("Fetch.catch - request cancelled");
        return;
      }
      this.cancelled = true;
      this.options.debug && debug("Fetch.catch", err.message);
      detach(() => {
        this.options.onEnd(err);
      });
    });
  }

  sendMessage(msgBytes: Uint8Array) {
    this.send(msgBytes);
  }

  finishSend() {

  }

  start(metadata: Metadata) {
    this.metadata = metadata;
  }

  cancel() {
    if (this.cancelled) {
      this.options.debug && debug("Fetch.abort.cancel already cancelled");
      return;
    }
    this.cancelled = true;
    if (this.reader) {
      // If the reader has already been received in the pump then it can be cancelled immediately
      this.options.debug && debug("Fetch.abort.cancel");
      this.reader.cancel();
    } else {
      this.options.debug && debug("Fetch.abort.cancel before reader");
    }
    if (this.controller) {
      this.controller.abort();
    }
  }
}

export function detectFetchSupport(): boolean {
  return typeof Response !== "undefined" && Response.prototype.hasOwnProperty("body") && typeof Headers === "function";
}