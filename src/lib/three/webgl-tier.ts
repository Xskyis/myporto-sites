export type WebGLTier = 'none' | 'software' | 'hardware';

/**
 * Cheap capability probe (no three.js import) so we can decide whether to download the WebGL
 * bundle at all.
 *
 * `failIfMajorPerformanceCaveat` makes the browser refuse to create a context that would be
 * software-rendered (SwiftShader in headless Chrome / PageSpeed Insights, llvmpipe on GPU-less
 * Linux) – without paying for initialising that software renderer. Those visitors get the
 * static portrait instead of a 5fps one.
 */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|mesa offscreen|microsoft basic render/i;

function rendererName(gl: WebGLRenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
}

export function detectWebGL(opts: { allowSoftware?: boolean } = {}): WebGLTier {
  try {
    const probe = document.createElement('canvas');
    const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const hw = (probe.getContext('webgl2', attrs) || probe.getContext('webgl', attrs)) as WebGLRenderingContext | null;
    if (hw) {
      // Belt and braces: a browser configured to use a software ANGLE backend reports no caveat
      const software = SOFTWARE_RENDERER.test(rendererName(hw));
      hw.getExtension('WEBGL_lose_context')?.loseContext();
      return software ? 'software' : 'hardware';
    }
    if (!opts.allowSoftware) return 'software'; // or none – both mean "don't try"; we never check which
    const sw = (probe.getContext('webgl2') || probe.getContext('webgl')) as WebGLRenderingContext | null;
    if (!sw) return 'none';
    sw.getExtension('WEBGL_lose_context')?.loseContext();
    return 'software';
  } catch {
    return 'none';
  }
}
