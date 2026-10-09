
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
    float luminance = dot(color, vec3(0.299, 0.587, 0.114));
    float grayscaleMix = 1.0 - smoothstep(0.0, 0.7, uProgress);
    vec3 faded = mix(vec3(luminance), color, grayscaleMix);
    finalColor = vec4(faded * texel.a, texel.a) * uProgress;
}
