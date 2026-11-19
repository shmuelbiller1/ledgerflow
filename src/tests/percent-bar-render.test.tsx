import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import ChartDragBrush from '../components/charts/ChartDragBrush';

/**
 * #909-class guard at a rendered boundary: the chart brush divided by `rows.length` to place its
 * selection track. An empty report makes that 0/0 — a `NaN` width, which a browser drops, and the
 * block then fills the whole track while the "Selected:" line names no month at all.
 *
 * The rows are controlled props here, so this is the real component, not a shape assertion.
 */

const rows = (labels: string[]) => labels.map(label => ({ id: label, label }));

describe('chart drag brush track (#909 class)', () => {
  afterEach(() => cleanup());

  test('an empty report draws no selection track at all', () => {
    const { container } = render(
      <ChartDragBrush title="Profit" rows={[]} start={0} end={0} onChange={() => {}} />,
    );
    // The only absolutely-positioned band is the selection track; with no months there is none.
    const bands = [...container.querySelectorAll('div[aria-hidden="true"].absolute')];
    assert.equal(bands.length, 0, 'no track is drawn when there are no rows');
    assert.doesNotMatch(container.innerHTML, /NaN|Infinity/, 'no invalid width reaches the DOM');
  });

  test('a real selection keeps its proportion inside the track', () => {
    const { container } = render(
      <ChartDragBrush title="Profit" rows={rows(['Jan', 'Feb', 'Mar', 'Apr'])} start={1} end={1} onChange={() => {}} />,
    );
    const bands = [...container.querySelectorAll('div[aria-hidden="true"].absolute')];
    assert.equal(bands.length, 1);
    const track = bands[0] as HTMLElement;
    // Jan..Apr, selecting one of four months: a quarter of the track, offset one month in.
    assert.equal(track.style.width, '25%');
    assert.equal(track.style.left, '25%');
  });

  test('a stale range is clamped instead of drawing a width the browser rejects', () => {
    // A selection can outlive the rows it was made on (a shorter report, a new period). The maths
    // then produces a negative width; the track must stay inside [0,100] and never say NaN.
    const reversed = render(
      <ChartDragBrush title="Profit" rows={rows(['Jan', 'Feb'])} start={5} end={1} onChange={() => {}} />,
    );
    const empty = [...reversed.container.querySelectorAll('div[aria-hidden="true"].absolute')][0] as HTMLElement;
    assert.equal(empty.style.width, '0%', 'a reversed range draws no track');
    cleanup();

    const past = render(
      <ChartDragBrush title="Profit" rows={rows(['Jan', 'Feb'])} start={500} end={500} onChange={() => {}} />,
    );
    const track = [...past.container.querySelectorAll('div[aria-hidden="true"].absolute')][0] as HTMLElement;
    for (const value of [track.style.width, track.style.left]) {
      assert.match(value, /^-?\d+(\.\d+)?%$/, `${value} is a real percentage`);
      const number = Number.parseFloat(value);
      assert.ok(number >= 0 && number <= 100, `${value} stays inside the track`);
    }
  });
});
