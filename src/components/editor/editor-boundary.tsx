"use client";

import { Component, type ReactNode } from "react";

/** Catches errors while BlockNote builds the document, so a bad document never becomes a blank, autosaving editor. */
export class EditorBoundary extends Component<
  { fallback: (message: string) => ReactNode; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Editor failed to open document", error);
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error.message);
    return this.props.children;
  }
}
