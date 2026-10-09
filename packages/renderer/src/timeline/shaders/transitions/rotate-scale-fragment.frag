
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

void main(void)
{
    if (uRole < 0.5) { finalColor = texture(uTexture, vTextureCoord); return; }
    vec2 p = frameUv() - 0.5;
    float angle = (1.0 - uProgress) * 0.35;
    mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 coord = rotation * p / mix(1.8, 1.0, uProgress) + 0.5;
    if (coord.x < 0.0 || coord.y < 0.0 || coord.x > 1.0 || coord.y > 1.0) { finalColor = vec4(0.0); return; }
    finalColor = texture(uTexture, coord * frameSize()) * uProgress;
}
