declare module "tar-fs" {
	import type { Readable, Writable } from "node:stream";
	export function pack(dir: string): Readable;
	export function extract(dir: string): Writable;
}
