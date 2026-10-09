
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
    // Premultiplied alpha: one multiply fades colour and alpha together.
    float amount = mix(1.0 - uProgress, uProgress, uRole);
    finalColor = texel * amount;
}
