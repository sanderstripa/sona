export class SonaPageGlassChild extends JSWindowActorChild {
  handleEvent(event) {
    this.sendAsyncMessage('scroll', {
      atTop: this.contentWindow.scrollY <= 0,
      document: event.target === this.document,
    });
  }

  receiveMessage() {
    return this.contentWindow.scrollY <= 0;
  }
}
