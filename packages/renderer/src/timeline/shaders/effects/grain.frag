
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

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(void) {
  vec4 source = texture(uTexture, vTextureCoord); float noise = hash(vTextureCoord * uInputSize.xy + uTime * vec2(37.0, 17.0));
  finalColor = premultiply(unpremultiply(source) + (noise - 0.5) * uAmount * 0.34, source.a);
}
