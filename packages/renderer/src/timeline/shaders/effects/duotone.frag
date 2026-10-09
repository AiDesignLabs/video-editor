
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
  vec4 source = texture(uTexture, vTextureCoord); vec3 color = unpremultiply(source);
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722)); vec3 mapped = mix(vec3(0.08, 0.02, 0.18), vec3(1.0, 0.72, 0.18), luma);
  finalColor = premultiply(mix(color, mapped, uAmount), source.a);
}
