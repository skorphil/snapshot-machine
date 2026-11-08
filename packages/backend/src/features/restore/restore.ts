/**
 * Copies a snapshot file to a destination path. Uses GNU cp with reflinks when
 * the filesystem supports them (falling back to a regular copy otherwise),
 * keeps holes sparse, and preserves mode, owner:group and xattrs.
 *
 * Ownership preservation needs privileges to chown to other users; a failure
 * is reported as a restore error rather than silently dropping metadata.
 */
export async function restoreFile(srcPath: string, destPath: string) {
  const command = new Deno.Command("cp", {
    args: [
      "--reflink=auto",
      "--sparse=always",
      "--preserve=mode,ownership,xattr",
      "--",
      srcPath,
      destPath,
    ],
  });

  const { success, stderr } = await command.output();
  if (!success) {
    throw new Error(
      `Restore failed: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
}
