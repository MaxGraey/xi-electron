import { elt, removeChildren, on } from '../../../utils/dom';
import { StyleSpan, N_RESERVED_STYLES, COLORS } from '../../style-map';

import { View, ViewOptions, Viewport } from '../index';
import ViewController from '../../view-controller';
import LineCache, { Line } from '../../line-cache';
import FontMetrics from './font-metrics';

/**
 * A view built using the Document Object Model.
 * The scrolling mechanism takes inspiration from CodeMirror.
 * See http://marijnhaverbeke.nl/blog/a-pathological-scrolling-model.html
 */
export default class DOMView implements View {

  private wrapper: HTMLElement;
  private sizer: HTMLElement;
  private scroller: HTMLElement;
  private lines: HTMLElement;
  private mover: HTMLElement;

  private metrics: FontMetrics;
  private lineCache: LineCache;

  constructor(private controller: ViewController, _opts: ViewOptions) {
    this.wrapper = controller.wrapper;
    this.lineCache = controller.lineCache;

    this.metrics = new FontMetrics(this.wrapper, {
      family: 'monospace',
      size: 20
    });

    this.wrapper.style.background = COLORS.BACKGROUND;

    this.scroller = controller.wrapper.appendChild(elt('div', null, 'scroller', `
      overflow: scroll !important;
      /* 30px is the magic margin used to hide the element's real scrollbars */
      /* See overflow: hidden in .CodeMirror */
      margin-bottom: -30px; margin-right: -30px;
      padding-bottom: 30px;
      position: relative;
    `));
    on(this.scroller, 'scroll', (event) => this.onScroll(event), { capture: false, passive: true });
    this.sizer = this.scroller.appendChild(elt('div', null, 'sizer', `
      position: relative;
      border-right: 30px solid transparent;
    `));
    this.mover = this.sizer.appendChild(elt('div', null, 'mover', 'position: relative'));
    this.lines = this.mover.appendChild(elt('div', null, 'lines', 'min-height: 1px; cursor: text;'));

    this.lineCache.on('update', () => this.updateViewport());
  }

  /**
   * Private API
   */

  private updateViewport(): void {
    this.sizer.style.height = `${this.calculateTotalHeight()}px`;
  }

  private calculateTotalHeight(): number {
    const { lineStart, lineEnd } = this.getViewport();
    const visibleLines = lineEnd - lineStart;
    return this.metrics.lineHeight() * (this.lineCache.height() + visibleLines - 2);
  }

  private onScroll(_event: MouseWheelEvent): void {
    this.controller.updateViewport();
    this.render();
  }

  /**
   * View API
   */

  public resize(width: number, height: number): void {
    this.scroller.style.width = `${width}px`;
    this.scroller.style.height = `${height}px`;

    this.render();
  }

  public scrollTo(line: number, char: number): void {
    this.sizer.scrollTop = this.metrics.lineHeight() * line;
    this.sizer.scrollLeft = this.metrics.asciiWidth() * char;
  }

  public posFromCoords(x: number, y: number): [number, number] {
    return [0, 0];
  }

  public getViewport(): Viewport {
    const asciiWidth = this.metrics.asciiWidth();
    const lineHeight = this.metrics.lineHeight();
    // TODO: gutter and offsets
    const xOffset = 0; // this.gutterWidth - this.editorPadding[0];
    const { scrollTop, scrollLeft, clientHeight, clientWidth } = this.scroller;
    return {
      lineStart: Math.floor(scrollTop / lineHeight),
      lineEnd: Math.floor((scrollTop + clientHeight) / lineHeight),
      charStart: Math.floor(scrollLeft / asciiWidth),
      charEnd: Math.floor((clientWidth + scrollLeft - xOffset) / asciiWidth),
    };
  }

  public render(): void {
    // Empty container.
    removeChildren(this.lines);

    let { lineStart, lineEnd } = this.getViewport();
    this.lineCache.computeMissing(lineStart, lineEnd);

    // Push mover forward as we scroll.
    this.mover.style.top = `${lineStart * this.metrics.lineHeight()}px`;

    for (let i = lineStart; i < lineEnd + 1; ++i) {
      const line = this.lineCache.get(i);
      if (!line) { continue; }

      const lineNode = new LineNode(line, this.metrics);
      this.lines.appendChild(lineNode.element);
    }
  }
}

/**
 * Represents a line in the DOM editor.
 */
class LineNode {
  public element: HTMLPreElement;

  private asciiWidth: number;
  private lineHeight: number;

  constructor(public line: Line, private metrics: FontMetrics) {
    this.asciiWidth = this.metrics.asciiWidth();
    this.lineHeight = this.metrics.lineHeight();
    this.element = (<HTMLPreElement>elt('pre', null, null, `position: relative;
                                                            margin: 0;
                                                            font: ${this.metrics.fontString()}`));

    // Build DOM cursors.
    line.cursors.forEach((char) => {
      this.element.appendChild(this.createCursor(char));
    });

    // Build DOM spans from StyleSpans.
    line.styles.forEach((styleSpan) => {
      this.element.appendChild(this.nodeFromStyleSpan(styleSpan));
    });
  }

  createCursor(char: number): HTMLElement {
    return elt('div', null, null, `position: absolute;
                                   border: 1px solid ${COLORS.CURSOR};
                                   height: ${this.lineHeight}px;
                                   left: ${this.asciiWidth * char}px`);
  }

  nodeFromStyleSpan(styleSpan: StyleSpan): HTMLSpanElement {
    const { style, range: { start, length } } = styleSpan;
    const css = `
      font: ${style.fontString(this.metrics)};
      color: ${style.fg};
    `;
    return elt('span', this.line.text.substr(start, length), null, css);
  }
}
