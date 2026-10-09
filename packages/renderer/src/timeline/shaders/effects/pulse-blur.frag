
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
  vec4 source = texture(uTexture, vTextureCoord);
  float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
  vec2 texel = uInputSize.zw * (1.0 + pulse * 5.0);
  vec3 color = (sampleColor(vTextureCoord + vec2(texel.x, 0.0)) + sampleColor(vTextureCoord - vec2(texel.x, 0.0)) + sampleColor(vTextureCoord + vec2(0.0, texel.y)) + sampleColor(vTextureCoord - vec2(0.0, texel.y))) * 0.25;
  finalColor = premultiply(mix(unpremultiply(source), color, pulse * 0.72), source.a);
}
