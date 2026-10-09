
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

uniform vec4 uFlashColor;

vec3 unpremultiply(vec4 c)
{
    return c.a > 0.0 ? c.rgb / c.a : c.rgb;
}

void main(void)
{
    vec4 texel = texture(uTexture, vTextureCoord);
    // Peaks at the midpoint, where the two sides swap over.
    float mixFactor = 1.0 - abs(2.0 * uProgress - 1.0);
    float past = step(0.5, uProgress);
    float visible = mix(1.0 - past, past, uRole);

    vec3 color = mix(unpremultiply(texel), uFlashColor.rgb, mixFactor);
    float alpha = texel.a * visible;
    finalColor = vec4(color * alpha, alpha);
}
