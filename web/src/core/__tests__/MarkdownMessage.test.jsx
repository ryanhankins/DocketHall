import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownMessage from '../MarkdownMessage.jsx';

describe('MarkdownMessage', () => {
  it('renders LaTeX math expressions cleanly without raw TeX commands', () => {
    const text =
      '$$\\text{Height} = (\\text{Average Elevation of Eaves}) + 70\\% \\text{ of the vertical distance}$$';
    render(<MarkdownMessage text={text} />);
    expect(
      screen.getByText('Height = (Average Elevation of Eaves) + 70% of the vertical distance')
    ).toBeInTheDocument();
  });

  it('renders markdown pipe tables', () => {
    const text = [
      '| Lot Line | Setback |',
      '| :--- | :--- |',
      '| Street | 30 ft. |',
    ].join('\n');
    render(<MarkdownMessage text={text} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('30 ft.')).toBeInTheDocument();
  });
});
