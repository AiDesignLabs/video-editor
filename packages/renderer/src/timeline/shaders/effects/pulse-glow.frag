
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
  vec4 source = texture(uTexture, vTextureCoord); float pulse = 0.55 + 0.45 * sin(uTime * 3.5);
  vec2 texel = uInputSize.zw * (2.0 + pulse * 6.0);
  vec3 glow = (sampleColor(vTextureCoord + vec2(texel.x, 0.0)) + sampleColor(vTextureCoord - vec2(texel.x, 0.0)) + sampleColor(vTextureCoord + vec2(0.0, texel.y)) + sampleColor(vTextureCoord - vec2(0.0, texel.y))) * 0.25;
  finalColor = premultiply(mix(unpremultiply(source), glow + vec3(0.12, 0.04, 0.02) * pulse, pulse * 0.78), source.a);
}
