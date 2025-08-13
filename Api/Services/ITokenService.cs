using Api.Models;

namespace Api.Services;

public interface ITokenService
{

    (string accessToken, string refreshToken) GenerateTokens(User user);
}