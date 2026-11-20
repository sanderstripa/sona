export class SonaPageGlassChild extends JSWindowActorChild {
  viewport() {
    const win = this.contentWindow;
    return { x: win.scrollX, y: win.scrollY, width: win.innerWidth, height: win.innerHeight };
  }

  receiveMessage({ name }) {
    if (name !== 'viewport') {
      return null;
    }
    if (!this.onScroll) {
      this.onScroll = () => this.sendAsyncMessage('scroll', this.viewport());
      this.contentWindow.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    }
    return this.viewport();
  }

  didDestroy() {
    if (this.onScroll) {
      this.contentWindow?.removeEventListener('scroll', this.onScroll, true);
    }
  }
}
