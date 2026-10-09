
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uAmount;
uniform float uTime;
vec3 unpremultiply(vec4 c) { return c.a > 0.0001 ? c.rgb / c.a : c.rgb; }
vec4 premultiply(vec3 rgb, float alpha) { return vec4(clamp(rgb, 0.0, 1.0) * alpha, alpha); }
vec3 sampleColor(vec2 uv) { return unpremultiply(texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw))); }

void main(void) {
  vec4 source = texture(uTexture, vTextureCoord); vec2 uv = vTextureCoord / max(uInputClamp.zw, vec2(0.0001));
  float sweep = fract(uTime * 0.18); float band = smoothstep(sweep - 0.24, sweep, uv.x) * (1.0 - smoothstep(sweep, sweep + 0.24, uv.x));
  vec3 leak = mix(vec3(1.0, 0.16, 0.04), vec3(1.0, 0.72, 0.12), uv.y);
  finalColor = premultiply(unpremultiply(source) + leak * band * uAmount * 0.8, source.a);
}
