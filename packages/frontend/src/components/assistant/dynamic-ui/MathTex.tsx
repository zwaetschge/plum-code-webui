import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * KaTeX like the chat's Markdown formulas. `trust` stays off, so commands
 * such as \href or \htmlClass cannot inject links or markup.
 */
export default function MathTex({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    output: 'htmlAndMathml',
    maxSize: 20,
    maxExpand: 200,
  });
  return (
    <span
      className={display ? 'dui-math is-display' : 'dui-math'}
      // KaTeX escapes its input; with trust disabled the output is static markup.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
