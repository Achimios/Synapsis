import { createRoot } from 'react-dom/client';
import { useEffect, useState, useCallback } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Shell, NodeCard, PortalCard, edgeLook, nodeDim } from './shell.jsx';

function SNode({ data }) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      {data.portal ? <PortalCard portal={data.portal} dim={data.dim} /> : <NodeCard node={data.node} img={data.img} dim={data.dim} isSel={data.isSel} />}
      <Handle type="source" position={Position.Right} />
    </>
  );
}
const nodeTypes = { s: SNode };

function RFCanvas({ view, layout, selected, images, onSelect, onDrill, onConnect, onMove }) {
  const build = () => [
    ...view.nodes.map(n => ({ id: n.id, type: 's', position: layout[n.id], data: { node: n, img: images[n.id], dim: nodeDim(n.id, view, selected), isSel: n.id === selected }, selected: n.id === selected })),
    ...view.portals.map(p => ({ id: p.id, type: 's', position: layout[p.id], data: { portal: p, dim: nodeDim(p.id, view, selected) }, selected: p.id === selected })),
  ];
  const [nodes, setNodes] = useState(build);
  // 外部数据变 → 重建，但保留本地坐标与 RF 的测量结果（丢了 measured 节点会被隐藏到重新测量完）
  useEffect(() => {
    setNodes(prev => {
      const old = new Map(prev.map(n => [n.id, n]));
      return build().map(n => { const o = old.get(n.id); return o ? { ...o, ...n, position: o.position } : n; });
    });
  }, [view, layout, selected, images]);

  const edges = view.edges.map(e => {
    const l = edgeLook(e, selected);
    return {
      id: e.id, source: e.from, target: e.to,
      label: e.count > 1 ? '×' + e.count : undefined,
      style: { stroke: l.color, strokeWidth: l.width, opacity: l.opacity },
      labelStyle: { fill: l.color, opacity: l.opacity }, labelBgStyle: { opacity: l.opacity * 0.8 },
      markerEnd: { type: MarkerType.ArrowClosed, color: l.color },
      selectable: false,
    };
  });

  const onNodesChange = useCallback(ch => setNodes(ns => applyNodeChanges(ch.filter(c => c.type !== 'select'), ns)), []);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
      onNodeClick={(_, n) => onSelect(n.id === selected ? null : n.id)}
      onPaneClick={() => onSelect(null)}
      onNodeDoubleClick={(_, n) => onDrill(n.id)}
      onNodeDragStop={(_, n, dragged) => onMove(Object.fromEntries((dragged || [n]).map(d => [d.id, d.position])))}
      onConnect={c => onConnect(c.source, c.target)}
      zoomOnDoubleClick={false} deleteKeyCode={null} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.1}>
      <Background gap={20} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

createRoot(document.getElementById('root')).render(<Shell name="reactflow" Canvas={RFCanvas} />);
