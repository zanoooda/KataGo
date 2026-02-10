'use client';

import { AnalysisFrame } from '@/lib/types';

type TreeNode = {
  move: string;
  visits: number;
  children: Map<string, TreeNode>;
};

function getOrCreate(parent: Map<string, TreeNode>, move: string): TreeNode {
  const existing = parent.get(move);
  if (existing) return existing;
  const created: TreeNode = { move, visits: 0, children: new Map() };
  parent.set(move, created);
  return created;
}

function buildTree(frame: AnalysisFrame | null): TreeNode[] {
  if (!frame) return [];

  const roots = new Map<string, TreeNode>();
  for (const mi of frame.moveInfos.slice(0, 12)) {
    const sequence = [mi.move, ...(mi.pv ?? [])].slice(0, 12);
    let parent = roots;
    for (const move of sequence) {
      const node = getOrCreate(parent, move);
      node.visits += mi.visits || 0;
      parent = node.children;
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => ({ ...n, children: new Map(sortNodes([...n.children.values()]).map((c) => [c.move, c])) }))
      .sort((a, b) => b.visits - a.visits);

  return sortNodes([...roots.values()]);
}

function renderNodes(nodes: TreeNode[], path: string): React.ReactNode {
  return (
    <ul className="treeList">
      {nodes.map((node, idx) => {
        const key = `${path}-${idx}-${node.move}`;
        const children = [...node.children.values()];
        return (
          <li key={key} className="treeItem">
            <div className="treeNode" title={`Move ${node.move}, total visits: ${node.visits}`}>
              <span className="treeMove">{node.move}</span>
              <span className="treeVisits">{node.visits}</span>
            </div>
            {children.length ? renderNodes(children, key) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function AnalysisTree({ frame }: { frame: AnalysisFrame | null }) {
  const roots = buildTree(frame);
  if (!roots.length) {
    return <div className="treeEmpty">No tree yet: run analysis for a position.</div>;
  }

  return (
    <div className="tree">
      <div className="treeMeta" title="Tree built from top candidates and their PV lines.">
        Top PV branches
      </div>
      {renderNodes(roots, 'root')}
    </div>
  );
}
