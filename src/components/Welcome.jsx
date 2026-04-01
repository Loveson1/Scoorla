import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, X, CheckCircle, Zap, Shield, BarChart3 } from "lucide-react";
import { isOnboardingComplete } from "../utils/onboardingUtils";

export default function Welcome() {
  const navigate = useNavigate();
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const checkOnboarding = async () => {
      const complete = await isOnboardingComplete();
      if (complete) {
        navigate("/school-dashboard", { replace: true });
      }
    };
    checkOnboarding();
  }, [navigate]);

  const slides = [
    {
      id: 1,
      icon: BarChart3,
      headline: "Welcome to Scoorla",
      description:
        "Transform how you manage student results. Scoorla makes result processing faster, easier, and more accurate for schools across Nigeria.",
      bgColor: "bg-blue-50 dark:bg-blue-900/20",
      iconColor: "text-blue-600 dark:text-blue-300",
    },
    {
      id: 2,
      icon: Zap,
      headline: "Process Results Instantly",
      description:
        "Say goodbye to manual calculations and spreadsheets. Scoorla automatically calculates scores, grades, and rankings in seconds—saving you hours of work every term.",
      bgColor: "bg-amber-50 dark:bg-amber-900/20",
      iconColor: "text-amber-600 dark:text-amber-300",
    },
    {
      id: 3,
      icon: Shield,
      headline: "Secure Your School Data",
      description:
        "Your school's data is protected with enterprise-grade security. All student records are encrypted and backed up automatically for peace of mind.",
      bgColor: "bg-green-50 dark:bg-green-900/20",
      iconColor: "text-green-600 dark:text-green-300",
    },
    {
      id: 4,
      icon: CheckCircle,
      headline: "Ready to Get Started?",
      description:
        "Set up your school profile in minutes and start using Scoorla today. We're here to guide you every step of the way.",
      bgColor: "bg-purple-50 dark:bg-purple-900/20",
      iconColor: "text-purple-600 dark:text-purple-300",
    },
  ];

  const slide = slides[currentSlide];
  const Icon = slide.icon;

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      // Final slide completed, go to onboarding
      navigate("/school");
    }
  };

  const handleSkip = () => {
    navigate("/school");
  };

  const goToSlide = (index) => {
    setCurrentSlide(index);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col">
      {/* Header with Skip Button */}
      <div className="flex justify-between items-center p-4 md:p-6">
        <div className="w-8"></div>
        <button
          onClick={handleSkip}
          className="flex items-center gap-1 text-sm md:text-base font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          title="Skip introduction"
        >
          <span>Skip</span>
          <X className="w-4 h-4 md:w-5 md:h-5" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-4 md:px-6">
        <div className="w-full max-w-[560px] text-center">
          {/* Slide Content with Animation */}
          <div className="mb-12 animate-fadeIn">
            {/* Icon Container */}
            <div className={`${slide.bgColor} w-24 h-24 mx-auto mb-8 rounded-full p-6 flex items-center justify-center transition-all duration-300`}>
              <Icon className={`w-12 h-12 ${slide.iconColor}`} />
            </div>

            {/* Headline */}
            <h2 className="text-3xl md:text-4xl font-bold text-black dark:text-white mb-4">
              {slide.headline}
            </h2>

            {/* Description */}
            <p className="text-gray-600 dark:text-gray-300 text-base md:text-lg leading-relaxed">
              {slide.description}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 md:gap-4 mb-8 ">
            {currentSlide > 0 && (
              <button
                onClick={() => goToSlide(currentSlide - 1)}
                className="flex-1 px-6 py-2 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex-1  px-8 py-2 bg-blue-800 btn text-white font-semibold rounded-lg hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2"
            >
              {currentSlide === slides.length - 1 ? (
                <>
                  <span>Get Started</span>
                  <CheckCircle className="w-5 h-5" />
                </>
              ) : (
                <>
                  <span>Next</span>
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="pb-6 md:pb-8">
        <div className="flex justify-center items-center gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`transition-all duration-300 rounded-full ${
                index === currentSlide
                  ? "w-8 h-2 bg-gradient-to-r from-blue-800 to-blue-900"
                  : "w-2 h-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500"
              }`}
              title={`Slide ${index + 1}`}
            />
          ))}
        </div>
        <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 text-center mt-4">
          {currentSlide + 1} of {slides.length}
        </p>
      </div>
    </div>
  );
}
