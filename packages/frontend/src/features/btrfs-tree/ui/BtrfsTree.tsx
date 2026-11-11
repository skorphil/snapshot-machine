import { useState } from "react";
import type {
  BtrfsSubvolume,
  BtrfsVolume,
} from "@snapshot-machine/shared/types.ts";
import { useBtrfsVolumes } from "../model/use-btrfs-volumes.ts";

/** Props of one subvolume row and its descendants. */
type SubvolumeNodeProps = {
  node: BtrfsSubvolume;
  depth: number;
};

/** One subvolume with a toggle for its children. Collapsed unless it is a top-level entry. */
function SubvolumeNode({ node, depth }: SubvolumeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const label = node.path || "<top level>";

  return (
    <li className="btrfs-tree-item">
      <div className="btrfs-tree-row">
        {hasChildren
          ? (
            <button
              type="button"
              className="btrfs-tree-toggle"
              aria-expanded={expanded}
              aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "▾" : "▸"}
            </button>
          )
          : <span className="btrfs-tree-toggle-spacer" aria-hidden="true" />}
        <span className="btrfs-tree-path" title={node.path}>{label}</span>
        <span className="btrfs-tree-id">ID {node.id}</span>
        {node.mountPoints.map((mountPoint) => (
          <code key={mountPoint} className="btrfs-tree-mount">
            {mountPoint}
          </code>
        ))}
      </div>
      {hasChildren && expanded && (
        <ul className="btrfs-tree-list">
          {node.children.map((child) => (
            <SubvolumeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Props of one volume section. */
type VolumeSectionProps = {
  volume: BtrfsVolume;
};

/** One btrfs filesystem with its mount points and subvolume tree, or the reason it could not be listed. */
function VolumeSection({ volume }: VolumeSectionProps) {
  return (
    <section className="btrfs-tree-volume">
      <header className="btrfs-tree-volume-header">
        <code className="btrfs-tree-device">{volume.device}</code>
        {volume.mountPoints.map((mountPoint) => (
          <code key={mountPoint} className="btrfs-tree-mount">
            {mountPoint}
          </code>
        ))}
      </header>
      {volume.error
        ? <p className="btrfs-tree-volume-error" role="alert">{volume.error}</p>
        : volume.subvolumes.length === 0
        ? <p className="btrfs-tree-hint">No subvolumes found.</p>
        : (
          <ul className="btrfs-tree-list">
            {volume.subvolumes.map((node) => (
              <SubvolumeNode key={node.id} node={node} depth={0} />
            ))}
          </ul>
        )}
    </section>
  );
}

/**
 * Tree view of the mounted btrfs filesystems and their subvolumes, read through
 * the Root Helper. Shows loading, empty and error states.
 */
export function BtrfsTree() {
  const { volumes, loading, error, reload } = useBtrfsVolumes();

  return (
    <div className="btrfs-tree">
      <div className="btrfs-tree-toolbar">
        <h2 className="btrfs-tree-title">Btrfs Volumes</h2>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
        >
          Reload
        </button>
      </div>

      {loading && (
        <p className="btrfs-tree-status" role="status">Loading volumes…</p>
      )}

      {error && (
        <p className="btrfs-tree-error" role="alert">
          Could not list Btrfs volumes: {error}
        </p>
      )}

      {!loading && !error && volumes.length === 0 && (
        <p className="btrfs-tree-hint">No mounted Btrfs filesystems found.</p>
      )}

      {volumes.map((volume) => (
        <VolumeSection
          key={volume.device + volume.mountPoints.join("|")}
          volume={volume}
        />
      ))}
    </div>
  );
}
