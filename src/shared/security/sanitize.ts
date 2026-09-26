import sanitizeHtml from 'sanitize-html';

// C0 control characters except TAB (\x09), LF (\x0A) and CR (\x0D), plus DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Turns untrusted text into safe plain text: every HTML tag is removed
 * (including the contents of <script>/<style>), remaining `<`, `>` and `&` are
 * HTML-escaped, and invisible control characters are stripped.
 *
 * This is defence in depth. The API only returns JSON with
 * `X-Content-Type-Options: nosniff`, and SQL injection is prevented separately
 * by parameterised queries.
 */
export function sanitizePlainText(input: string): string {
  const withoutTags = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
  return withoutTags.replace(CONTROL_CHARACTERS, '').trim();
}
