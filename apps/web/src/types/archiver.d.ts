import type { Archiver, ArchiverOptions } from "archiver";

// The installed archiver 8 uses named constructors; @types/archiver 7 only
// describes the old factory. Keep this small bridge aligned with archiver's
// installed index.js until its official types expose the v8 entry points.
declare module "archiver" {
  export const ZipArchive: new (options?: ArchiverOptions) => Archiver;
}
