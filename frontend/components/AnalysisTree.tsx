'use client';

import { AnalysisFrame } from '@/lib/types';

type TreeNode = {
  move: string;
  visits: number;
  children: Map<string, TreeNode>;
};

function buildTree(frame: AnalysisFrame | null): TreeNode[] {
  if (!frame) return [];
  const roots = new Map<string, TreeNode>();

  for (const mi of frame.moveInfos.slice(0, 10)) {
    let parentMap = roots;
    let current: TreeNode | undefined;
    const sequence = [mi.move, ...(mi.pv ?? [])].slice(0, 10);
    for (const mv of sequence) {
      if (!parentMap.has(mv)) {
        parentMap.set(mv, { move: mv, visits: mi.visits, children: new Map() });
      }
      current = parentMap.get(mv);
      parentMap = current!.children;
    }
  }

  return [...roots.values()];
}

function renderNodes(nodes: TreeNode[], depth = 0): React.ReactNode {
  return nodes.map((n) => (
    <div key={`${depth}-${n.move}-${n.visits}`} style={{ marginLeft: depth * 12 }}>
      <span>{n.move}</span>
      <small> ({n.visits})</small>
      {renderNodes([...n.children.values()], depth + 1)}
    </div>
  ));
}

export function AnalysisTree({ frame }: { frame: AnalysisFrame | null }) {
  const tree = buildTree(frame);
  return <div className="tree">{tree.length ? renderNodes(tree) : <p>No tree yet.</p>}</div>;
}
