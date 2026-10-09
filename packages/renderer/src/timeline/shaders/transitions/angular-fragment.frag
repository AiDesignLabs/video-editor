
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


vec2 frameSize()
{
    return max(uInputClamp.zw, vec2(0.0001));
}

vec2 frameUv()
{
    return vTextureCoord / frameSize();
}

bool outsideFrame(vec2 coord)
{
    return coord.x < uInputClamp.x || coord.y < uInputClamp.y
        || coord.x > uInputClamp.z || coord.y > uInputClamp.w;
}

uniform float uStartingAngle;
const float PI = 3.14159265359;
void main(void)
{
    vec4 texel = texture(uTexture, vTextureCoord);
    if (uRole < 0.5) { finalColor = texel; return; }
    vec2 p = frameUv() - 0.5;
    float angle = atan(p.y, p.x) + uStartingAngle * PI / 180.0;
    float normalized = fract((angle + PI) / (2.0 * PI));
    finalColor = texel * step(normalized, uProgress);
}
