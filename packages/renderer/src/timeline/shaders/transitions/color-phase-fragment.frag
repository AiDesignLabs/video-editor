
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;

uniform float uProgress;
uniform float uRole;

vec3 transitionUnpremultiply(vec4 c)
{
    return c.a > 0.0001 ? c.rgb / c.a : c.rgb;
}

vec4 transitionPremultiply(vec3 rgb, float alpha)
{
    return vec4(clamp(rgb, 0.0, 1.0) * alpha, alpha);
}

void main(void)
{
    vec4 texel = texture(uTexture, vTextureCoord);
    if (uRole < 0.5) { finalColor = texel; return; }
    vec3 color = transitionUnpremultiply(texel);
    vec3 tint = mix(vec3(0.12, 0.04, 0.22), vec3(0.95, 0.35, 0.12), uProgress);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    finalColor = transitionPremultiply(mix(color, tint * (0.35 + luminance), uProgress), texel.a);
}
